import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getHealth } from "../api";

const BackendContext = createContext(null);
const POLL_MS = 5000;

/**
 * Polls /api/health so every component knows whether the backend is reachable.
 * status: "checking" (first probe) | "online" | "offline"
 */
export function BackendProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [lastChecked, setLastChecked] = useState(null);
  const alive = useRef(true);

  const check = useCallback(async () => {
    try {
      await getHealth();
      if (alive.current) setStatus("online");
    } catch {
      if (alive.current) setStatus("offline");
    } finally {
      if (alive.current) setLastChecked(new Date());
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [check]);

  return (
    <BackendContext.Provider value={{ status, online: status === "online", lastChecked, recheck: check }}>
      {children}
    </BackendContext.Provider>
  );
}

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend must be used inside <BackendProvider>");
  return ctx;
}
