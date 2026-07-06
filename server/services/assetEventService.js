import { db } from "../db.js";

export function recordAssetEvent({
  userId,
  eventType,
  gameType = null,
  amount,
  balanceBefore,
  balanceAfter,
  sourceType = null,
  sourceId = null,
  detail = {},
}) {
  return db
    .prepare(
      `INSERT INTO asset_events
       (user_id, event_type, game_type, amount, balance_before, balance_after,
        source_type, source_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      eventType,
      gameType,
      amount,
      balanceBefore,
      balanceAfter,
      sourceType,
      sourceId === null ? null : String(sourceId),
      JSON.stringify(detail),
    );
}
