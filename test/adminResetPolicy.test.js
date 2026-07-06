import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_RESET_TARGETS,
  parseAdminResetTargets,
} from "../server/services/adminResetPolicy.js";

test("admin reset defaults to every target for backward compatibility", () => {
  assert.deepEqual(parseAdminResetTargets(undefined), ADMIN_RESET_TARGETS);
});

test("admin reset deduplicates and follows the server target order", () => {
  assert.deepEqual(
    parseAdminResetTargets(["achievements", "balance", "achievements"]),
    ["balance", "achievements"],
  );
});

test("admin reset rejects empty, malformed, and unknown target lists", () => {
  assert.throws(() => parseAdminResetTargets([]), /하나 이상/);
  assert.throws(() => parseAdminResetTargets("balance"), /형식/);
  assert.throws(() => parseAdminResetTargets(["balance", "unknown"]), /허용되지 않은/);
});
