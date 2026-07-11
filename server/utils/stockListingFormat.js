export const NEWLY_LISTED_BADGE_DURATION_MINUTES = 10;

export function formatListedDate(listedAt) {
  if (!listedAt) return "상장일 미정";

  const date = new Date(listedAt);
  if (Number.isNaN(date.getTime())) return "상장일 미정";

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return "상장일 미정";
  return `${year}.${month}.${day}`;
}

export function formatListedAge(listedAt, now = new Date()) {
  if (!listedAt) return "상장일 미정";

  const listedDate = new Date(listedAt);
  const currentDate = now instanceof Date ? now : new Date(now);
  const listedMs = listedDate.getTime();
  const currentMs = currentDate.getTime();

  if (!Number.isFinite(listedMs) || !Number.isFinite(currentMs)) {
    return "상장일 미정";
  }

  const diffMs = currentMs - listedMs;
  if (diffMs < 0) return "상장 전";

  const diffMinutes = Math.floor(diffMs / 1000 / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "방금 상장";
  if (diffMinutes < 60) return `상장 ${diffMinutes}분차`;
  if (diffHours < 24) return `상장 ${diffHours}시간차`;
  return `상장 ${diffDays + 1}일차`;
}

export function isNewlyListedByTime(listedAt, now = new Date()) {
  if (!listedAt) return false;

  const listedMs = new Date(listedAt).getTime();
  const currentMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (!Number.isFinite(listedMs) || !Number.isFinite(currentMs)) return false;

  const durationMs = NEWLY_LISTED_BADGE_DURATION_MINUTES * 60 * 1000;
  return currentMs >= listedMs && currentMs - listedMs <= durationMs;
}

export function getStockListingInfo(stock, now = new Date()) {
  const status = stock?.status || "";
  const listedAt = status === "ipo_subscription" ? null : stock?.listed_at || stock?.listedAt || null;
  const newlyListedUntil = stock?.newly_listed_until || stock?.newlyListedUntil || null;

  return {
    listedAt,
    listedDateText: formatListedDate(listedAt),
    listedAgeText: formatListedAge(listedAt, now),
    isNewlyListed:
      status === "newly_listed" ||
      isNewlyListedByTime(listedAt, now) ||
      (newlyListedUntil && new Date(newlyListedUntil).getTime() > new Date(now).getTime()),
    newlyListedUntil,
  };
}
