import { useEffect, useMemo, useState } from "react";

export function useMarketClock({ serverTime, nextTickAt } = {}) {
  const [now, setNow] = useState(Date.now());

  const serverTimeOffset = useMemo(() => {
    if (!serverTime) return 0;
    const serverMs = new Date(serverTime).getTime();
    if (!Number.isFinite(serverMs)) return 0;
    return serverMs - Date.now();
  }, [serverTime]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const serverNow = now + serverTimeOffset;
  const nextTickMs = nextTickAt ? new Date(nextTickAt).getTime() : NaN;
  const nextTickRemainingSeconds = Number.isFinite(nextTickMs)
    ? Math.max(0, Math.ceil((nextTickMs - serverNow) / 1000))
    : null;

  const remainingSecondsUntil = (targetTime) => {
    const targetMs = targetTime ? new Date(targetTime).getTime() : NaN;
    if (!Number.isFinite(targetMs)) return null;
    return Math.max(0, Math.ceil((targetMs - serverNow) / 1000));
  };

  return {
    serverNow,
    nextTickRemainingSeconds,
    remainingSecondsUntil,
  };
}
