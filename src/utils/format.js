export function formatMoney(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

export function formatSignedMoney(value) {
  const number = Math.round(Number(value) || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("ko-KR")}원`;
}

export function formatPercent(value, digits = 2) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
