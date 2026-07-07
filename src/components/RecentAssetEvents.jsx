import { useMemo } from 'react';
import { formatDate, formatSignedMoney } from '../utils/format';
import { gameMeta } from '../data/games';
export default function RecentAssetEvents({ points, range }) {
  const recent = points
    .filter((point) => !["range_start", "current"].includes(point.eventType) && point.amount !== 0)
    .slice(-3)
    .reverse();
  if (!recent.length) return null;

  const timeLabel = (value) =>
    new Intl.DateTimeFormat("ko-KR", range === "day"
      ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }
      : { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(value));

  return (
    <div className="mt-5 border-t border-base-300/60 pt-4">
      <h3 className="mb-3 text-xs font-black text-base-content/45">최근 주요 자산 이벤트</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {recent.map((point) => (
          <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-base-200/55 p-3" key={point.id}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${point.amount >= 0 ? "bg-success/15" : "bg-error/15"}`}>
              {point.amount >= 0 ? "↗" : "↘"}
            </span>
            <div className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-base-content/50">
                {assetEventLabels[point.eventType] || "자산 변화"} · {timeLabel(point.createdAt)}
              </span>
              <strong className={`block truncate text-xs tabular-nums ${point.amount >= 0 ? "text-success" : "text-error"}`}>
                {formatSignedMoney(point.amount)}
              </strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
