import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { errorMessage, scanNetwork } from "../api";
import { useBackend } from "./BackendContext";

const NetworkContext = createContext(null);

/** Holds the latest network discovery result so every page shares one scan. */
export function NetworkProvider({ children }) {
  const { online } = useBackend();
  const [devices, setDevices] = useState([]);
  const [meta, setMeta] = useState(null); // {subnet, method, timestamp}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const started = useRef(false);
  const loadingRef = useRef(false);

  const scan = useCallback(async (subnet) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await scanNetwork(subnet);
      setDevices(data.devices);
      setMeta({ subnet: data.subnet, method: data.method, timestamp: data.timestamp });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Scan once when the app loads (guarded against StrictMode double effects).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    scan();
  }, [scan]);

  // If the first scan failed because the backend was down, scan again once it's back.
  useEffect(() => {
    if (online && error && !devices.length && !loadingRef.current) scan();
  }, [online, error, devices.length, scan]);

  return (
    <NetworkContext.Provider value={{ devices, meta, loading, error, scan }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside <NetworkProvider>");
  return ctx;
}
