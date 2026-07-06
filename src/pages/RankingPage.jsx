import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatMoney } from "../utils/format";

const rankingTypes = {
  currentBalance: {
    label: "현재 자산",
    icon: "👛",
    eyebrow: "WEALTHY POCKETS",
    title: "가장 묵직한 행운주머니",
    description: "지금 가장 많은 행운을 담고 있는 주머니예요.",
    tone: "balance",
  },
  achievements: {
    label: "업적",
    icon: "🏅",
    eyebrow: "LUCK COLLECTORS",
    title: "가장 많은 행운을 수집한 사람",
    description: "다양한 도전으로 업적 배지를 가장 많이 모았어요.",
    tone: "achievement",
  },
  games: {
    label: "게임 횟수",
    icon: "🎮",
    eyebrow: "STEADY PLAYERS",
    title: "가장 열심히 주머니를 흔든 사람",
    description: "꾸준히 숫자 게임을 즐긴 플레이어 순위예요.",
    tone: "games",
  },
};

function seoulDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const calendar = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  calendar.setUTCDate(calendar.getUTCDate() + offsetDays);
  return [
    calendar.getUTCFullYear(),
    String(calendar.getUTCMonth() + 1).padStart(2, "0"),
    String(calendar.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export default function RankingPage() {
  const { user } = useAuth();
  const today = useMemo(() => seoulDate(), []);
  const [date, setDate] = useState(today);
  const [period, setPeriod] = useState("day");
  const [type, setType] = useState("currentBalance");
  const [data, setData] = useState({ rankings: [], myStats: null, myRank: null });
  const [serverStats, setServerStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const selected = rankingTypes[type];

  useEffect(() => {
    setLoading(true);
    api(`/leaderboard?date=${date}&period=${period}&type=${type}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [date, period, type, user.balance]);

  useEffect(() => {
    api("/server/stats").then(setServerStats).catch(() => {});
  }, []);

  const podium = data.rankings.slice(0, 3);
  const remaining = data.rankings.slice(3);
  const selectDate = (nextDate, nextPeriod = "day") => {
    setDate(nextDate);
    setPeriod(nextPeriod);
  };
  const periodLabel =
    period === "week" ? "이번 주" : period === "month" ? "이번 달" : date === today ? "오늘" : date;

  return (
    <div className="page-content">
      <div className="mb-6">
        <p className="eyebrow">Leaderboard</p>
        <h1 className="text-3xl font-black">행운주머니 리더보드</h1>
        <p className="mt-2 text-sm text-base-content/55">
          자산, 업적, 플레이 기록 중 보고 싶은 기준을 골라보세요.
        </p>
      </div>

      {serverStats && (
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-base-300/60 bg-base-100 px-4 py-3 text-xs font-bold text-base-content/55 shadow-sm">
          <span>전체 가입자 <strong className="text-primary tabular-nums">{serverStats.totalUsers.toLocaleString("ko-KR")}명</strong></span>
          <span>누적 게임 <strong className="tabular-nums">{serverStats.totalGames.toLocaleString("ko-KR")}판</strong></span>
          <span>오늘 활동 <strong className="tabular-nums">{serverStats.activeUsersToday.toLocaleString("ko-KR")}명</strong></span>
        </div>
      )}

      <section className="ranking-date-card">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Ranking date</p>
            <h2 className="text-xl font-black">랭킹 기준 날짜</h2>
          </div>
          <span className="badge badge-primary badge-outline whitespace-nowrap font-black">
            {periodLabel} · 자동 반영
          </span>
        </div>
        <div className="ranking-date-controls">
          <label className="block min-w-0 lg:w-60 lg:shrink-0">
            <span className="mb-1.5 block text-xs font-black text-base-content/55">날짜 선택</span>
            <input
              type="date"
              className="ranking-date-input input input-bordered w-full text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={date}
              max={today}
              onChange={(event) => selectDate(event.target.value, "day")}
            />
          </label>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <DateButton active={period === "day" && date === today} onClick={() => selectDate(today)}>오늘</DateButton>
            <DateButton active={period === "day" && date === seoulDate(-1)} onClick={() => selectDate(seoulDate(-1))}>어제</DateButton>
            <DateButton active={period === "week"} onClick={() => selectDate(today, "week")}>이번 주</DateButton>
            <DateButton active={period === "month"} onClick={() => selectDate(today, "month")}>이번 달</DateButton>
          </div>
        </div>
      </section>

      <div className="ranking-tabs" role="tablist" aria-label="리더보드 기준">
        {Object.entries(rankingTypes).map(([key, tab]) => (
          <button
            type="button"
            role="tab"
            aria-selected={type === key}
            key={key}
            className={`ranking-tab ${type === key ? "is-active" : ""}`}
            onClick={() => setType(key)}
          >
            <span className="text-xl" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <section className={`leaderboard-hero tone-${selected.tone}`} key={`hero-${type}`}>
        <div className="relative z-10">
          <span className="mb-3 inline-flex rounded-full bg-base-100/55 px-3 py-1 text-[11px] font-black">
            {periodLabel} 기준
          </span>
          <p className="text-[11px] font-black tracking-[0.16em] opacity-65">{selected.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl">{selected.title}</h2>
          <p className="mt-2 max-w-xl text-sm font-bold opacity-65">{selected.description}</p>
        </div>
        <span className="leaderboard-hero-icon" aria-hidden="true">{selected.icon}</span>
      </section>

      {loading ? (
        <div className="loading-block mt-5" />
      ) : (
        <div className="ranking-transition" key={`${type}-${date}-${period}`}>
          {podium.length > 0 && (
            <section className="podium-grid" aria-label="상위 3명">
              {podium.map((ranking, index) => (
                <PodiumCard
                  key={ranking.userId}
                  ranking={ranking}
                  type={type}
                  place={index + 1}
                  mine={ranking.userId === user.id}
                />
              ))}
            </section>
          )}

          {data.myStats && (
            <section className="my-rank-card">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-2xl shadow-sm">🐣</span>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-black text-base-content/45">내 순위</span>
                <strong className="block truncate text-base font-black">{data.myStats.nickname}</strong>
              </div>
              <div className="text-right">
                <strong className="block text-2xl font-black text-primary tabular-nums">#{data.myRank}</strong>
                <span className="text-xs font-black tabular-nums">{primaryValue(data.myStats, type)}</span>
                <span className="mt-1 block text-[10px] font-bold text-base-content/45">
                  재도전 {data.myStats.bankruptcyCount.toLocaleString("ko-KR")}회
                </span>
              </div>
            </section>
          )}

          {remaining.length > 0 && (
            <section className="ranking-list-card">
              {remaining.map((ranking) => (
                <RankingRow
                  key={ranking.userId}
                  ranking={ranking}
                  type={type}
                  mine={ranking.userId === user.id}
                />
              ))}
            </section>
          )}

          {data.rankings.length === 0 && (
            <div className="empty-state mt-5">아직 순위에 표시할 주머니가 없어요.</div>
          )}
        </div>
      )}
    </div>
  );
}

function DateButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`btn h-12 min-h-12 whitespace-nowrap rounded-2xl ${active ? "btn-primary" : "btn-outline border-base-300 bg-base-100"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function primaryValue(ranking, type) {
  if (type === "achievements") return `${ranking.achievementCount.toLocaleString("ko-KR")}개 달성`;
  if (type === "games") return `${ranking.totalGames.toLocaleString("ko-KR")}판`;
  return formatMoney(ranking.balance);
}

function secondaryStats(ranking, type) {
  if (type === "achievements") {
    return [
      ["현재 자산", formatMoney(ranking.balance)],
      ["게임", `${ranking.totalGames.toLocaleString("ko-KR")}판`],
      ["재도전", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
    ];
  }
  if (type === "games") {
    return [
      ["현재 자산", formatMoney(ranking.balance)],
      ["업적", `${ranking.achievementCount.toLocaleString("ko-KR")}개`],
      ["재도전", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
    ];
  }
  return [
    ["업적", `${ranking.achievementCount.toLocaleString("ko-KR")}개`],
    ["게임", `${ranking.totalGames.toLocaleString("ko-KR")}판`],
    ["재도전", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
  ];
}

function PodiumCard({ ranking, type, place, mine }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <article className={`podium-card place-${place} ${mine ? "is-mine" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-3xl" aria-label={`${place}위`}>{medals[place - 1]}</span>
        {mine && <span className="badge badge-primary badge-sm font-black">나</span>}
      </div>
      <span className="mt-4 block truncate text-sm font-black text-base-content/60">{ranking.nickname}</span>
      <strong className="podium-primary-value">{primaryValue(ranking, type)}</strong>
      <div className="mt-4 flex flex-wrap gap-2">
        {secondaryStats(ranking, type).map(([label, value]) => (
          <span className="podium-mini-stat" key={label}>
            {label} <strong>{value}</strong>
          </span>
        ))}
      </div>
    </article>
  );
}

function RankingRow({ ranking, type, mine }) {
  return (
    <article className={`ranking-row ${mine ? "is-mine" : ""}`}>
      <span className="ranking-number">{ranking.rank}</span>
      <div className="min-w-0 flex-1">
        <strong className="block truncate font-black">
          {ranking.nickname}
          {mine && <span className="badge badge-primary badge-xs ml-2">나</span>}
        </strong>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-base-content/45">
          {secondaryStats(ranking, type).map(([label, value]) => (
            <span key={label}>{label} {value}</span>
          ))}
        </div>
      </div>
      <strong className="ranking-primary-value">{primaryValue(ranking, type)}</strong>
    </article>
  );
}
