#!/usr/bin/env python3
"""Start NetPulse (backend + frontend) with one command.

    python run.py              # install missing deps, start both, open the browser
    python run.py --no-browser # don't open a browser tab
    python run.py --skip-install

Ctrl+C stops everything. Works on Windows, macOS and Linux.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
BACKEND_PORT = 8000
FRONTEND_PORT = 5173
HEALTH_URL = f"http://localhost:{BACKEND_PORT}/api/health"
FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}"
IS_WINDOWS = os.name == "nt"

# Import names for backend/requirements.txt
BACKEND_MODULES = ["fastapi", "uvicorn", "scapy", "nmap", "requests", "websockets", "dotenv"]
NMAP_PATHS = [
    r"C:\Program Files (x86)\Nmap\nmap.exe",
    r"C:\Program Files\Nmap\nmap.exe",
    "/usr/bin/nmap",
    "/usr/local/bin/nmap",
    "/opt/homebrew/bin/nmap",
]

if IS_WINDOWS:
    os.system("")  # enable ANSI colours in the Windows console
# Child output (e.g. Vite's "➜") may not fit the console's legacy code page.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
CYAN, VIOLET, YELLOW, RED, DIM, BOLD, RESET = (
    "\033[96m", "\033[95m", "\033[93m", "\033[91m", "\033[2m", "\033[1m", "\033[0m",
)


def say(msg: str, color: str = CYAN) -> None:
    print(f"{color}[netpulse]{RESET} {msg}", flush=True)


def fail(msg: str) -> None:
    say(msg, RED)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Checks & installs
# ---------------------------------------------------------------------------
def check_python() -> None:
    if sys.version_info < (3, 10):
        fail(f"Python 3.10+ is required (found {sys.version.split()[0]}).")


def find_npm() -> str:
    npm = shutil.which("npm")
    if not npm:
        fail("npm not found. Install Node.js 18+ from https://nodejs.org and try again.")
    return npm


def install_backend(force: bool) -> None:
    missing = [m for m in BACKEND_MODULES if importlib.util.find_spec(m) is None]
    if not missing and not force:
        return
    say(f"Installing backend dependencies{' (missing: ' + ', '.join(missing) + ')' if missing else ''}...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")])
    if r.returncode != 0:
        fail("pip install failed. See the output above.")


def install_frontend(npm: str, force: bool) -> None:
    marker = FRONTEND / "node_modules" / ".package-lock.json"
    lock = FRONTEND / "package-lock.json"
    stale = not marker.exists() or (lock.exists() and lock.stat().st_mtime > marker.stat().st_mtime)
    if not stale and not force:
        return
    say("Installing frontend dependencies (npm install)...")
    r = subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=FRONTEND)
    if r.returncode != 0:
        fail("npm install failed. See the output above.")


def warn_if_no_nmap() -> None:
    if os.getenv("NMAP_PATH") or shutil.which("nmap") or any(Path(p).exists() for p in NMAP_PATHS):
        return
    say("nmap not found: the Port Scanner page won't work until you install it (https://nmap.org).", YELLOW)


# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------
def port_in_use(port: int) -> bool:
    """True if anything listens on the port over IPv4 or IPv6 (Vite on Windows binds ::1 only)."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                if s.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def http_ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.5) as r:
            return r.status == 200
    except OSError:
        return False


def backend_healthy() -> bool:
    return http_ok(HEALTH_URL)


def start(name: str, cmd: list[str], cwd: Path, color: str) -> subprocess.Popen:
    kwargs: dict = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "FORCE_COLOR": "1"}
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1, **kwargs,
    )

    def pump() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(f"{color}{name:>8} |{RESET} {line.rstrip()}", flush=True)

    threading.Thread(target=pump, daemon=True).start()
    return proc


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            # Kill the whole tree: npm.cmd -> node (vite) would otherwise be orphaned.
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=8)
    except Exception:
        proc.kill()


def wait_until(check, timeout: float, procs: list[subprocess.Popen]) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if check():
            return True
        if any(p.poll() is not None for p in procs):
            return False
        time.sleep(0.5)
    return False


# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Run the NetPulse backend and frontend together.")
    parser.add_argument("--no-browser", action="store_true", help="don't open the dashboard in a browser")
    parser.add_argument("--skip-install", action="store_true", help="skip dependency checks/installs")
    parser.add_argument("--reinstall", action="store_true", help="force pip install and npm install")
    args = parser.parse_args()

    # Treat SIGTERM / Ctrl+Break like Ctrl+C so child processes always get cleaned up.
    def interrupt(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    if IS_WINDOWS:
        signal.signal(signal.SIGBREAK, interrupt)

    check_python()
    npm = find_npm()
    if not args.skip_install:
        install_backend(args.reinstall)
        install_frontend(npm, args.reinstall)
    warn_if_no_nmap()

    procs: list[subprocess.Popen] = []

    if backend_healthy():
        say(f"Backend already running on :{BACKEND_PORT}, reusing it.", YELLOW)
    elif port_in_use(BACKEND_PORT):
        fail(f"Port {BACKEND_PORT} is used by another program. Stop it and try again.")
    else:
        say("Starting backend...")
        procs.append(start("backend", [sys.executable, "main.py"], BACKEND, CYAN))

    if port_in_use(FRONTEND_PORT):
        fail(f"Port {FRONTEND_PORT} is already in use (is the frontend already running?). Stop it and try again.")
    say("Starting frontend...")
    procs.append(start("frontend", [npm, "run", "dev", "--", "--strictPort"], FRONTEND, VIOLET))

    try:
        if not wait_until(backend_healthy, 60, procs):
            raise RuntimeError("backend did not become healthy")
        if not wait_until(lambda: http_ok(FRONTEND_URL), 60, procs):
            raise RuntimeError("frontend did not start")

        print(
            f"\n{BOLD}  NetPulse is running{RESET}\n"
            f"  {CYAN}Dashboard{RESET}  {FRONTEND_URL}\n"
            f"  {CYAN}API{RESET}        http://localhost:{BACKEND_PORT}  {DIM}(docs: /docs){RESET}\n"
            f"  {DIM}Press Ctrl+C to stop.{RESET}\n",
            flush=True,
        )
        if not args.no_browser:
            webbrowser.open(FRONTEND_URL)

        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        exited = next(p for p in procs if p.poll() is not None)
        say(f"A process exited (code {exited.returncode}); shutting down.", YELLOW)
        code = exited.returncode or 1
    except KeyboardInterrupt:
        print()
        say("Stopping...")
        code = 0
    except RuntimeError as exc:
        say(f"Startup failed: {exc}. See the output above.", RED)
        code = 1
    finally:
        for p in procs:
            stop(p)

    say("Stopped.")
    sys.exit(code)


if __name__ == "__main__":
    main()
