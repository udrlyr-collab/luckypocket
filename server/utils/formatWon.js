const UNITS = [
  "",
  "만",
  "억",
  "조",
  "경",
  "해",
  "자",
  "양",
  "구",
  "간",
  "정",
  "재",
  "극",
  "항하사",
  "아승기",
  "나유타",
  "불가사의",
  "무량대수",
];

export function formatKoreanNumber(value, maxParts = 2) {
  const numeric = Number(value);
  const number = Number.isFinite(numeric) ? numeric : 0;
  const negative = number < 0;
  const absolute = Math.round(Math.abs(number));
  if (absolute < 100_000_000) {
    return `${negative ? "-" : ""}${absolute.toLocaleString("ko-KR")}`;
  }

  const exponent = Math.floor(Math.log10(absolute));
  const maxUnitExponent = (UNITS.length - 1) * 4;
  if (exponent >= UNITS.length * 4) {
    const coefficient = absolute / (10 ** exponent);
    return `${negative ? "-" : ""}약 ${coefficient.toFixed(2)}×10^${exponent - maxUnitExponent}무량대수`;
  }

  const digits = BigInt(absolute).toString();
  const groups = [];
  for (let end = digits.length, unitIndex = 0; end > 0; end -= 4, unitIndex += 1) {
    const start = Math.max(0, end - 4);
    const chunk = Number(digits.slice(start, end));
    if (chunk > 0) {
      groups.push(`${chunk.toLocaleString("ko-KR")}${UNITS[unitIndex]}`);
    }
  }
  return `${negative ? "-" : ""}${groups.reverse().slice(0, maxParts).join(" ")}`;
}

export function formatWon(value) {
  return `${formatKoreanNumber(value)}원`;
}

export function formatSignedWon(value) {
  const numeric = Number(value);
  const sign = Number.isFinite(numeric) && numeric > 0 ? "+" : "";
  return `${sign}${formatWon(value)}`;
}
