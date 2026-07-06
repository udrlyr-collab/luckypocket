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
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  
  if (abs >= 100000000) {
    const units = [
      '', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극', 
      '항하사', '아승기', '나유타', '불가사의', '무량대수'
    ];
    let s = '';
    try {
      s = BigInt(Math.round(abs)).toString();
    } catch (e) {
      s = abs.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 });
    }

    let parts = [];
    let len = s.length;
    for (let i = 0; i < units.length && len > 0; i++) {
      let start = Math.max(0, len - 4);
      let chunk = s.substring(start, len);
      let val = parseInt(chunk, 10);
      if (val > 0) {
        parts.push(`${val.toLocaleString("ko-KR")}${units[i]}`);
      }
      len -= 4;
    }
    
    if (len > 0) {
      parts.push(s.substring(0, len) + "무량대수초과");
    }
    
    parts.reverse();
    let result = parts.slice(0, 3).join(' ');
    
    if (result === '') result = '0';
    return (number < 0 ? "-" : "") + result + "원";
  }
  return formatMoney(value);
}
