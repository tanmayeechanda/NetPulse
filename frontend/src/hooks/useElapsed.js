import { useEffect, useState } from "react";

/** Seconds elapsed while `running` is true (resets when it starts again). */
export default function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    setSeconds(0);
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}
