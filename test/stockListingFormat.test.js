import test from "node:test";
import assert from "node:assert/strict";
import {
  formatListedAge,
  formatListedDate,
  getStockListingInfo,
} from "../server/utils/stockListingFormat.js";

test("formatListedAge formats recent and daily listed age", () => {
  assert.equal(
    formatListedAge("2026-07-08T03:00:00.000Z", new Date("2026-07-08T03:00:30.000Z")),
    "방금 상장",
  );
  assert.equal(
    formatListedAge("2026-07-08T03:00:00.000Z", new Date("2026-07-08T03:12:00.000Z")),
    "상장 12분차",
  );
  assert.equal(
    formatListedAge("2026-07-08T03:00:00.000Z", new Date("2026-07-08T08:00:00.000Z")),
    "상장 5시간차",
  );
  assert.equal(
    formatListedAge("2026-07-08T03:00:00.000Z", new Date("2026-07-10T03:00:00.000Z")),
    "상장 3일차",
  );
});

test("formatListedDate uses Korean date text without time", () => {
  assert.equal(formatListedDate("2026-07-08T03:00:00.000Z"), "2026.07.08");
});

test("getStockListingInfo hides listed_at for ipo subscription stocks", () => {
  const info = getStockListingInfo(
    {
      status: "ipo_subscription",
      listed_at: "2026-07-08T03:00:00.000Z",
      newly_listed_until: null,
    },
    new Date("2026-07-08T03:05:00.000Z"),
  );

  assert.equal(info.listedAt, null);
  assert.equal(info.listedDateText, "상장일 미정");
  assert.equal(info.listedAgeText, "상장일 미정");
});
