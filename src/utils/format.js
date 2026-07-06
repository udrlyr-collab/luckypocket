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

export function formatCompactMoney(value) {
  const number = Math.round(Number(value) || 0);
  const abs = Math.abs(number);
  
  if (abs >= 100000000) {
    let result = '';
    const jo = Math.floor(abs / 1000000000000);
    const uk = Math.floor((abs % 1000000000000) / 100000000);
    const man = Math.floor((abs % 100000000) / 10000);
    
    if (jo > 0) result += `${jo.toLocaleString("ko-KR")}조 `;
    if (uk > 0) result += `${uk.toLocaleString("ko-KR")}억 `;
    if (man > 0) result += `${man.toLocaleString("ko-KR")}만 `;
    
    if (result === '') result = '0 ';
    return (number < 0 ? "-" : "") + result.trim() + "원";
  }
  return formatMoney(value);
}
