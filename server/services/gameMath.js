import { randomBytes, randomInt } from "node:crypto";

export const RISK_STAGES = [
  { stepChance: 0.88, cumulativeChance: 0.88, multiplier: 1.12 },
  { stepChance: 0.75, cumulativeChance: 0.66, multiplier: 1.49 },
  { stepChance: 0.62, cumulativeChance: 0.4092, multiplier: 2.42 },
  { stepChance: 0.48, cumulativeChance: 0.196416, multiplier: 5.02 },
  { stepChance: 0.33, cumulativeChance: 0.06481728, multiplier: 15.2 },
  { stepChance: 0.21, cumulativeChance: 0.0136116288, multiplier: 72.3 },
  { stepChance: 0.1, cumulativeChance: 0.00136116288, multiplier: 723 },
];

export const CARD_BETS = {
  odd: { label: "홀수", chance: 0.5, multiplier: 1.97, test: (n) => n % 2 === 1 },
  even: { label: "짝수", chance: 0.5, multiplier: 1.97, test: (n) => n % 2 === 0 },
  ge7: { label: "7 이상", chance: 0.4, multiplier: 2.46, test: (n) => n >= 7 },
  ge8: { label: "8 이상", chance: 0.3, multiplier: 3.28, test: (n) => n >= 8 },
  ge9: { label: "9 이상", chance: 0.2, multiplier: 4.92, test: (n) => n >= 9 },
  exact: { label: "정확한 숫자", chance: 0.1, multiplier: 9.85 },
};

export const DART_BETS = {
  wide: { label: "넓은 원", chance: 0.49, multiplier: 2, radius: 0.7 },
  middle: { label: "중간 원", chance: 0.25, multiplier: 3.92, radius: 0.5 },
  small: { label: "작은 원", chance: 0.0625, multiplier: 15.68, radius: 0.25 },
  bullseye: { label: "불스아이", chance: 0.01, multiplier: 98, radius: 0.1 },
  sector: { label: "특정 섹터", chance: 0.05, multiplier: 19.6, needsSector: true },
  sector_middle: {
    label: "섹터 + 중간 원",
    chance: 0.0125,
    multiplier: 78.4,
    radius: 0.5,
    needsSector: true,
  },
  sector_bullseye: {
    label: "섹터 + 불스아이",
    chance: 0.0005,
    multiplier: 1960,
    radius: 0.1,
    needsSector: true,
    event: true,
  },
};

export function cryptoFloat() {
  return randomBytes(6).readUIntBE(0, 6) / 281474976710656;
}

export function chance(chanceValue) {
  return cryptoFloat() < chanceValue;
}

export function drawCardNumber() {
  return randomInt(1, 11);
}

export function createBombPositions(bombCount) {
  const numbers = Array.from({ length: 16 }, (_, index) => index + 1);
  for (let index = numbers.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [numbers[index], numbers[swapIndex]] = [numbers[swapIndex], numbers[index]];
  }
  return numbers.slice(0, bombCount).sort((a, b) => a - b);
}

export function combination(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0;
  const size = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= size; index += 1) {
    result = (result * (n - size + index)) / index;
  }
  return result;
}

export function bombSurvivalChance(bombCount, safeOpened) {
  const safeTotal = 16 - bombCount;
  if (safeOpened < 0 || safeOpened > safeTotal) return 0;
  return combination(safeTotal, safeOpened) / combination(16, safeOpened);
}

export function bombStage(bombCount, safeOpened) {
  if (safeOpened < 1) {
    return {
      chance: 1,
      targetRtp: 1,
      multiplier: 1,
    };
  }
  const chanceValue = bombSurvivalChance(bombCount, safeOpened);
  const skillBonus = Math.min(0.017, safeOpened * 0.0015 + bombCount * 0.0008);
  const targetRtp = Math.min(0.992, 0.975 + skillBonus);
  return {
    chance: chanceValue,
    targetRtp,
    multiplier: Number((targetRtp / chanceValue).toFixed(2)),
  };
}

const SEQUENCES = new Set([
  "012", "123", "234", "345", "456", "567", "678", "789",
  "987", "876", "765", "654", "543", "432", "321", "210",
]);

export function spinSlot() {
  return [randomInt(10), randomInt(10), randomInt(10)];
}

export function classifySlot(numbers) {
  const code = numbers.join("");
  if (code === "777") {
    return {
      outcome: "777",
      label: "777 잭팟",
      multiplier: 777,
    };
  }
  if (new Set(numbers).size === 1) {
    return { outcome: "triple", label: "같은 숫자 3개", multiplier: 27 };
  }
  if (SEQUENCES.has(code)) {
    return { outcome: "sequence", label: "연속 숫자", multiplier: 8.8 };
  }
  if (new Set(numbers).size === 2) {
    return { outcome: "pair", label: "같은 숫자 2개", multiplier: 1.75 };
  }
  return { outcome: "miss", label: "다음 행운을 기다려요", multiplier: 0 };
}

export function calculateSlotPayout({ balance, bet, outcome }) {
  return outcome.multiplier ? payoutFor(bet, outcome.multiplier) : 0;
}

export function throwDart() {
  const radius = Math.sqrt(cryptoFloat());
  const angle = 2 * Math.PI * cryptoFloat();
  return {
    roundId: `dart_${randomBytes(16).toString("hex")}`,
    radius,
    angle,
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
    sector: Math.floor(angle / ((2 * Math.PI) / 20)) + 1,
    score: Math.max(0, Math.floor((1 - radius) * 1_000)),
    rotationDeg: -58 + cryptoFloat() * 24,
    flightDurationMs: 650 + Math.floor(cryptoFloat() * 301),
  };
}

export function isDartWin(spec, result, selectedSector) {
  const radialMatch = spec.radius === undefined || result.radius <= spec.radius;
  const sectorMatch = !spec.needsSector || result.sector === selectedSector;
  return radialMatch && sectorMatch;
}

export function payoutFor(bet, multiplier) {
  return Math.floor(bet * multiplier);
}
