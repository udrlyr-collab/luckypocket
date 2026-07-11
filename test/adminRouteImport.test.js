import test from "node:test";
import assert from "node:assert/strict";

test("admin router imports with jackpot admin service exports available", async () => {
  const module = await import("../server/routes/admin.js");
  assert.ok(module.adminRouter);
});
