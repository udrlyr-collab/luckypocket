import { RISK_STAGES, payoutFor } from "./gameMath.js";

/** 고액 배팅 배당률 조정 상수 */
const THRESHOLD = 5_000_000;
const MIN_RTP = 1.01;
const TAPER_ALPHA = 0.45;

/**
 * 고액 배팅 시 배당률을 부드럽게 조정한다.
 * - betAmount <= THRESHOLD 이면 baseMultiplier 그대로 반환
 * - betAmount > THRESHOLD 이면 연속 함수(power-law)로 점진 감소
 * - 총 지급액은 배팅금이 커질수록 항상 증가
 * - 고액 배팅의 기대 지급률(RTP)은 최소 MIN_RTP(101%)까지 점진 조정
 */
export function getAdjustedMultiplier({ betAmount, baseMultiplier, cumulativeProbability }) {
  if (betAmount <= THRESHOLD) {
    return baseMultiplier;
  }

  const baseRtp = cumulativeProbability * baseMultiplier;
  const taperRatio = Math.pow(THRESHOLD / betAmount, TAPER_ALPHA);
  const targetRtp = MIN_RTP + (baseRtp - MIN_RTP) * taperRatio;
  const adjustedMultiplier = targetRtp / cumulativeProbability;

  return adjustedMultiplier;
}

/**
 * 특정 단계의 조정된 배당 정보를 반환한다.
 */
export function getRiskStagePayoutInfo(betAmount, stageIndex) {
  const spec = RISK_STAGES[stageIndex];
  if (!spec) return null;

  const baseMultiplier = spec.multiplier;
  const cumulativeProbability = spec.cumulativeChance;
  const effectiveMultiplier = getAdjustedMultiplier({
    betAmount,
    baseMultiplier,
    cumulativeProbability,
  });
  const expectedPayout = Math.floor(betAmount * effectiveMultiplier);
  const expectedProfit = expectedPayout - betAmount;
  const rtp = cumulativeProbability * effectiveMultiplier;
  const adjusted = effectiveMultiplier !== baseMultiplier;

  return {
    stage: stageIndex + 1,
    cumulativeProbability,
    baseMultiplier,
    effectiveMultiplier: Number(effectiveMultiplier.toFixed(4)),
    expectedPayout,
    expectedProfit,
    rtp: Number(rtp.toFixed(6)),
    adjusted,
  };
}

/**
 * 배팅금 기준으로 1~7단계 전체 미리보기 데이터를 생성한다.
 * 프론트엔드 배당 확인 모달과 미리보기 API에서 사용한다.
 */
export function getRiskPayoutPreview(betAmount) {
  const stages = RISK_STAGES.map((_, index) => getRiskStagePayoutInfo(betAmount, index));
  const isAdjusted = betAmount > THRESHOLD;

  return {
    betAmount,
    threshold: THRESHOLD,
    isAdjusted,
    stages,
  };
}

/**
 * 실제 캐시아웃 시 지급액을 계산한다.
 * stage는 1-indexed (1~7).
 * 미리보기 API와 반드시 동일한 계산 경로를 사용한다.
 */
export function calculateRiskCashoutPayout(betAmount, stage) {
  const stageIndex = stage - 1;
  const spec = RISK_STAGES[stageIndex];
  if (!spec) throw new Error(`Invalid risk stage: ${stage}`);

  const effectiveMultiplier = getAdjustedMultiplier({
    betAmount,
    baseMultiplier: spec.multiplier,
    cumulativeProbability: spec.cumulativeChance,
  });

  const payout = Math.floor(betAmount * effectiveMultiplier);
  const baseRtp = spec.cumulativeChance * spec.multiplier;
  const adjustedRtp = spec.cumulativeChance * effectiveMultiplier;
  const adjusted = effectiveMultiplier !== spec.multiplier;

  return {
    payout,
    detail: {
      betAmount,
      stage,
      baseMultiplier: spec.multiplier,
      effectiveMultiplier: Number(effectiveMultiplier.toFixed(4)),
      cumulativeProbability: spec.cumulativeChance,
      baseRtp: Number(baseRtp.toFixed(6)),
      adjustedRtp: Number(adjustedRtp.toFixed(6)),
      threshold: THRESHOLD,
      taperAlpha: TAPER_ALPHA,
      adjusted,
      payout,
      profit: payout - betAmount,
      cashedOut: true,
    },
  };
}

export { THRESHOLD, MIN_RTP, TAPER_ALPHA };
