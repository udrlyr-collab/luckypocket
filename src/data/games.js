export const gameMeta = {
  "risk-button": {
    path: "/games/risk",
    icon: "☝️",
    title: "위험버튼",
    summary: "누를수록 커지는 배당, 멈출 타이밍을 골라요.",
    color: "bg-pink-100",
  },
  "card-draw": {
    path: "/games/cards",
    icon: "🃏",
    title: "1부터 10 카드",
    summary: "숫자가 나오기 전에 행운의 조건을 골라요.",
    color: "bg-sky-100",
  },
  "bomb-dodge": {
    path: "/games/bombs",
    icon: "💣",
    title: "폭탄 숫자 피하기",
    summary: "폭탄 수를 고르고 4×4 보드에서 안전 칸을 열어요.",
    color: "bg-amber-100",
  },
  slot: {
    path: "/games/slot",
    icon: "🎰",
    title: "3자리 슬롯",
    summary: "같은 숫자와 연속 숫자를 찾아 돌려요.",
    color: "bg-violet-100",
  },
  dart: {
    path: "/games/dart",
    icon: "🎯",
    title: "다트 던지기",
    summary: "작은 목표일수록 행운이 통통 커져요.",
    color: "bg-emerald-100",
  },
};

export const riskStages = [
  { chance: 0.88, cumulative: 0.88, multiplier: 1.17 },
  { chance: 0.75, cumulative: 0.66, multiplier: 1.58 },
  { chance: 0.62, cumulative: 0.4092, multiplier: 2.6 },
  { chance: 0.48, cumulative: 0.196416, multiplier: 5.55 },
  { chance: 0.33, cumulative: 0.06481728, multiplier: 17.2 },
  { chance: 0.21, cumulative: 0.0136116288, multiplier: 84 },
  { chance: 0.1, cumulative: 0.00136116288, multiplier: 850 },
];

export const cardBets = [
  { key: "odd", label: "홀수", chance: 0.5, multiplier: 2.04 },
  { key: "even", label: "짝수", chance: 0.5, multiplier: 2.04 },
  { key: "ge7", label: "7 이상", chance: 0.4, multiplier: 2.6 },
  { key: "ge8", label: "8 이상", chance: 0.3, multiplier: 3.5 },
  { key: "ge9", label: "9 이상", chance: 0.2, multiplier: 5.3 },
  { key: "exact", label: "정확한 숫자", chance: 0.1, multiplier: 10.7 },
];

export const dartBets = [
  { key: "wide", label: "넓은 원", chance: 0.49, multiplier: 2.1 },
  { key: "middle", label: "중간 원", chance: 0.25, multiplier: 4.15 },
  { key: "small", label: "작은 원", chance: 0.0625, multiplier: 16.8 },
  { key: "bullseye", label: "불스아이", chance: 0.01, multiplier: 108 },
  { key: "sector", label: "특정 섹터", chance: 0.05, multiplier: 20.8, sector: true },
  {
    key: "sector_middle",
    label: "섹터 + 중간 원",
    chance: 0.0125,
    multiplier: 84,
    sector: true,
  },
  {
    key: "sector_bullseye",
    label: "섹터 + 불스아이",
    chance: 0.0005,
    multiplier: 2150,
    sector: true,
    event: true,
  },
];
