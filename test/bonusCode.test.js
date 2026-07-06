import test from "node:test";
import assert from "node:assert/strict";
import { bonusCodeLimitState } from "../server/services/bonusCodeService.js";

test("unlimited bonus codes ignore total and per-user use counts", () => {
  const state = bonusCodeLimitState(
    {
      is_unlimited: 1,
      used_count: Number.MAX_SAFE_INTEGER,
      max_total_uses: 1,
      max_uses_per_user: 1,
    },
    Number.MAX_SAFE_INTEGER,
  );
  assert.deepEqual(state, {
    totalLimitReached: false,
    userLimitReached: false,
  });
});

test("limited bonus codes enforce total and per-user limits", () => {
  const code = {
    is_unlimited: 0,
    used_count: 2,
    max_total_uses: 2,
    max_uses_per_user: 1,
  };
  assert.deepEqual(bonusCodeLimitState(code, 1), {
    totalLimitReached: true,
    userLimitReached: true,
  });
});
