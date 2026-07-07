export function StatusBadge({ status, label, className = "" }) {
  let badgeClass = "badge-neutral";
  
  if (status === "우량주" || status === "인수자 ETF") {
    badgeClass = "badge-primary";
  } else if (status === "신규 상장" || status === "인수됨") {
    badgeClass = "badge-secondary";
  } else if (status === "공모주" || status === "거래주의") {
    badgeClass = "badge-warning";
  } else if (status === "회생 중") {
    badgeClass = "badge-success";
  } else if (status === "상장폐지 심사") {
    badgeClass = "badge-error";
  } else if (status === "상장폐지") {
    badgeClass = "badge-neutral";
  }

  return (
    <span className={`badge badge-sm font-black border-0 ${badgeClass} ${className}`}>
      {label || status}
    </span>
  );
}
