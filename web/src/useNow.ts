import { useEffect, useState } from 'react';

/** Server-aligned "now" that re-renders every `ms`. */
export function useNow(clockOffset: number, ms = 250): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + clockOffset), ms);
    return () => clearInterval(t);
  }, [clockOffset, ms]);
  return now;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
