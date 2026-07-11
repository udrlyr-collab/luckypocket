export const STOCK_SECTORS = [
  "AI",
  "보안",
  "게임",
  "식품",
  "에너지",
  "광업",
  "바이오",
  "미디어",
  "운송",
  "금융",
  "소비재",
];

const SECTOR_KEYWORDS = [
  { sector: "AI", keywords: ["AI", "데이터", "로봇", "스마트", "클라우드"] },
  { sector: "보안", keywords: ["보안", "자물쇠", "실드", "락", "시큐"] },
  { sector: "게임", keywords: ["게임", "엔터", "플레이", "픽셀"] },
  { sector: "식품", keywords: ["식품", "푸드", "맛", "우유", "커피", "빵"] },
  { sector: "에너지", keywords: ["에너지", "전기", "태양", "배터리"] },
  { sector: "광업", keywords: ["광업", "다이아", "금광", "메탈", "마인"] },
  { sector: "바이오", keywords: ["바이오", "헬스", "제약", "메디"] },
  { sector: "미디어", keywords: ["미디어", "방송", "스튜디오", "콘텐츠"] },
  { sector: "운송", keywords: ["운송", "물류", "항공", "택배", "모빌"] },
  { sector: "금융", keywords: ["금융", "뱅크", "캐피탈", "페이"] },
  { sector: "소비재", keywords: ["소비", "리테일", "마켓", "상점"] },
];

export function inferStockSector(name = "", symbol = "") {
  const text = `${name} ${symbol}`.toLocaleLowerCase("ko-KR");
  const matched = SECTOR_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase("ko-KR"))),
  );
  if (matched) return matched.sector;

  let hash = 0;
  for (const char of text || "stock") {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return STOCK_SECTORS[hash % STOCK_SECTORS.length];
}

export function randomStockSector() {
  return STOCK_SECTORS[Math.floor(Math.random() * STOCK_SECTORS.length)];
}
