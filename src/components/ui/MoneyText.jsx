import { formatCompactMoney, formatMoney } from "../../utils/format";

export function MoneyText({ value, compact = false, className = "" }) {
  const formatted = compact ? formatCompactMoney(value) : formatMoney(value);
  return (
    <span className={`tabular-nums ${className}`}>
      {formatted}
    </span>
  );
}
