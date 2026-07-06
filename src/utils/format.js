const KOREAN_NUMBER_UNITS = [
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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatKoreanNumber(value, maxParts = 2) {
  const number = finiteNumber(value);
  const negative = number < 0;
  const absolute = Math.round(Math.abs(number));

  if (absolute < 100_000_000) {
    return `${negative ? "-" : ""}${absolute.toLocaleString("ko-KR")}`;
  }

  const exponent = Math.floor(Math.log10(absolute));
  const maxUnitExponent = (KOREAN_NUMBER_UNITS.length - 1) * 4;
  if (exponent >= KOREAN_NUMBER_UNITS.length * 4) {
    const coefficient = absolute / (10 ** exponent);
    const remainingExponent = exponent - maxUnitExponent;
    return `${negative ? "-" : ""}약 ${coefficient.toFixed(2)}×10^${remainingExponent}무량대수`;
  }

  const digits = BigInt(absolute).toString();
  const groups = [];
  for (let end = digits.length, unitIndex = 0; end > 0; end -= 4, unitIndex += 1) {
    const start = Math.max(0, end - 4);
    const chunk = Number(digits.slice(start, end));
    if (chunk > 0) {
      groups.push({
        unitIndex,
        text: `${chunk.toLocaleString("ko-KR")}${KOREAN_NUMBER_UNITS[unitIndex]}`,
      });
    }
  }

  const readable = groups
    .reverse()
    .slice(0, Math.max(1, maxParts))
    .map((group) => group.text)
    .join(" ");
  return `${negative ? "-" : ""}${readable || "0"}`;
}

export function formatMoney(value) {
  return `${formatKoreanNumber(value)}원`;
}

export function formatSignedMoney(value) {
  const number = finiteNumber(value);
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatKoreanNumber(number)}원`;
}

export function formatPercent(value, digits = 2) {
  return `${(finiteNumber(value) * 100).toFixed(digits)}%`;
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
  return `${formatKoreanNumber(value, 1)}원`;
}
