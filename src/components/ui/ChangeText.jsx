import { formatSignedMoney } from "../../utils/format";

export function ChangeText({ amount, percent, prefix = "", className = "" }) {
  const valueClass = amount > 0 ? "text-success" : amount < 0 ? "text-error" : "text-base-content/60";
  const sign = amount > 0 ? "+" : "";
  const formattedAmount = formatSignedMoney(amount);
  
  // Percent might be undefined (e.g. for simple profit)
  const percentText = percent !== undefined && percent !== null
    ? ` · ${sign}${percent > 0 ? percent.toFixed(1) : percent === 0 ? "0.0" : percent.toFixed(1)}%`
    : "";

  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${valueClass} ${className}`}>
      {prefix && <span>{prefix}</span>}
      <span>{formattedAmount}{percentText}</span>
    </span>
  );
}
