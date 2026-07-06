import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../utils/format";

export default function AnimatedMoney({ value, className = "" }) {
  const numericValue = Number(value || 0);
  const previousValue = useRef(numericValue);
  const frame = useRef(null);
  const clearDirection = useRef(null);
  const [displayValue, setDisplayValue] = useState(numericValue);
  const [direction, setDirection] = useState("");

  useEffect(() => {
    const from = previousValue.current;
    const to = numericValue;
    previousValue.current = to;

    if (frame.current) cancelAnimationFrame(frame.current);
    if (clearDirection.current) window.clearTimeout(clearDirection.current);

    if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayValue(to);
      setDirection("");
      return undefined;
    }

    setDirection(to > from ? "balance-count-up" : "balance-count-down");
    const startedAt = performance.now();
    const duration = 700;

    const count = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        frame.current = requestAnimationFrame(count);
      } else {
        frame.current = null;
        clearDirection.current = window.setTimeout(() => setDirection(""), 450);
      }
    };

    frame.current = requestAnimationFrame(count);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (clearDirection.current) window.clearTimeout(clearDirection.current);
    };
  }, [numericValue]);

  return (
    <span className={`${direction} ${className}`.trim()}>
      {formatMoney(displayValue)}
    </span>
  );
}
