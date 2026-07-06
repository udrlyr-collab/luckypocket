import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_BETS,
  DART_BETS,
  RISK_STAGES,
  bombStage,
  bombSurvivalChance,
  classifySlot,
  isDartWin,
  payoutFor,
} from "../server/services/gameMath.js";

test("all configured single-outcome games have positive player expectation", () => {
  for (const stage of RISK_STAGES) {
    assert.ok(stage.cumulativeChance * stage.multiplier > 1);
  }
  for (let bombCount = 1; bombCount <= 8; bombCount += 1) {
    for (let safeCount = 1; safeCount <= 16 - bombCount; safeCount += 1) {
      const stage = bombStage(bombCount, safeCount);
      assert.ok(stage.chance * stage.multiplier > 1);
      assert.ok(stage.targetRtp <= 1.15);
    }
  }
  for (const spec of Object.values(CARD_BETS)) {
    assert.ok(spec.chance * spec.multiplier > 1);
  }
  for (const spec of Object.values(DART_BETS)) {
    assert.ok(spec.chance * spec.multiplier > 1);
  }
});

test("slot classifier produces the documented 1000-outcome distribution", () => {
  const counts = { "777": 0, triple: 0, sequence: 0, pair: 0, miss: 0 };
  for (let first = 0; first < 10; first += 1) {
    for (let second = 0; second < 10; second += 1) {
      for (let third = 0; third < 10; third += 1) {
        counts[classifySlot([first, second, third]).outcome] += 1;
      }
    }
  }
  assert.deepEqual(counts, { "777": 1, triple: 9, sequence: 16, pair: 270, miss: 704 });
  const rtp = (1 * 170 + 9 * 27 + 16 * 8.8 + 270 * 1.75) / 1000;
  assert.equal(rtp, 1.0263);
});

test("4x4 bomb survival probability follows the combination formula", () => {
  assert.equal(bombSurvivalChance(2, 1), 14 / 16);
  assert.equal(bombSurvivalChance(8, 8), 1 / 12870);
  assert.equal(bombStage(2, 1).multiplier, 1.2);
});

test("dart target checks radius and sector together", () => {
  const result = { radius: 0.4, sector: 7 };
  assert.equal(isDartWin(DART_BETS.wide, result, null), true);
  assert.equal(isDartWin(DART_BETS.small, result, null), false);
  assert.equal(isDartWin(DART_BETS.sector_middle, result, 7), true);
  assert.equal(isDartWin(DART_BETS.sector_middle, result, 8), false);
});

test("payouts use integer won amounts and represent gross payment", () => {
  assert.equal(payoutFor(10000, 2.04), 20400);
  assert.equal(payoutFor(1000, 1.17), 1170);
});
