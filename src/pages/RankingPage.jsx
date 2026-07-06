import { useEffect, useMemo, useState, useRef } from "react";
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
  const [loading, setLoading] = useState(true);
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  
  const myRankRef = useRef(null);
  const [highlightMyRank, setHighlightMyRank] = useState(false);

  const selected = rankingTypes[type];

  const scrollToMyRank = () => {
    myRankRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightMyRank(true);
    setTimeout(() => setHighlightMyRank(false), 1200);
  };

  useEffect(() => {
    setLoading(true);
    api(`/leaderboard?date=${date}&period=${period}&type=${type}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [date, period, type, user.balance]);

  useEffect(() => {
    setLoading(true);
    api(`/leaderboard?date=${date}&period=${period}&type=${type}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [date, period, type, user.balance]);

  const podium = data.rankings.slice(0, 3);
  const remaining = data.rankings.slice(3);
  const selectDate = (nextDate, nextPeriod = "day") => {
    setDate(nextDate);
    setPeriod(nextPeriod);
  };
  const periodLabel =
    period === "week" ? "이번 주" : period === "month" ? "이번 달" : date === today ? "오늘" : date;

  return (
    <div className="page-content pt-2 pb-16">
      <section className="mb-4">
        <p className="eyebrow">LEADERBOARD</p>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">행운주머니 리더보드</h1>
            <p className="text-sm text-base-content/60">
              순위를 한눈에 확인해보세요.
            </p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <div className="sticky top-[72px] z-20 bg-base-100/90 backdrop-blur-md py-2 mb-3">
          <div className="tabs-boxed grid grid-cols-3 rounded-2xl p-1 bg-base-200/50">
            {Object.entries(rankingTypes).map(([key, tab]) => (
              <button
                type="button"
                key={key}
                className={`btn btn-sm h-9 rounded-xl border-none ${type === key ? "bg-base-100 text-primary shadow-sm font-black" : "bg-transparent text-base-content/60"}`}
                onClick={() => setType(key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-primary badge-outline font-bold">{periodLabel} 기준</span>
          <span className="text-sm text-base-content/60 tabular-nums">{date}</span>
          <button className="btn btn-xs btn-ghost rounded-lg" onClick={() => setIsDateFilterOpen(v => !v)}>
            날짜 변경 {isDateFilterOpen ? "▲" : "▼"}
          </button>
        </div>

        {isDateFilterOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-base-200/40">
            <input
              type="date"
              className="input input-sm input-bordered w-36 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={date}
              max={today}
              onChange={(event) => selectDate(event.target.value, "day")}
            />
            <div className="flex flex-wrap gap-1">
              <DateButton active={period === "day" && date === today} onClick={() => selectDate(today)}>오늘</DateButton>
              <DateButton active={period === "day" && date === seoulDate(-1)} onClick={() => selectDate(seoulDate(-1))}>어제</DateButton>
              <DateButton active={period === "week"} onClick={() => selectDate(today, "week")}>이번 주</DateButton>
              <DateButton active={period === "month"} onClick={() => selectDate(today, "month")}>이번 달</DateButton>
            </div>
          </div>
        )}
      </section>

      {loading ? (
        <div className="loading-block mt-5" />
      ) : (
        <div className="ranking-transition">
          <div className="mb-3">
            <h2 className="text-lg font-black">{selected.title}</h2>
            <p className="text-xs text-base-content/60">{selected.description}</p>
          </div>
          {podium.length > 0 && (
            <section className="podium-grid" aria-label="상위 3명">
              {podium.map((ranking, index) => (
                <PodiumCard
                  key={ranking.userId}
                  ranking={ranking}
                  type={type}
                  place={index + 1}
                  mine={ranking.userId === user.id}
                  innerRef={ranking.userId === user.id ? myRankRef : null}
                  highlight={ranking.userId === user.id && highlightMyRank}
                />
              ))}
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
                  innerRef={ranking.userId === user.id ? myRankRef : null}
                  highlight={ranking.userId === user.id && highlightMyRank}
                />
              ))}
            </section>
          )}

          {data.rankings.length === 0 && (
            <div className="empty-state mt-5">아직 순위에 표시할 주머니가 없어요.</div>
          )}
        </div>
      )}

      {data.myRank && (
        <button
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 btn btn-primary rounded-full shadow-lg font-bold"
          onClick={scrollToMyRank}
        >
          내 순위 보기
        </button>
      )}
    </div>
  );
}

function DateButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`btn btn-sm rounded-lg border-0 ${active ? "btn-primary" : "bg-base-100 text-base-content/70"}`}
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

function PodiumCard({ ranking, type, place, mine, innerRef, highlight }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <article 
      ref={innerRef}
      className={`podium-card place-${place} ${mine ? "is-mine" : ""} ${highlight ? "animate-rank-pulse" : ""}`}
    >
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

function RankingRow({ ranking, type, mine, innerRef, highlight }) {
  return (
    <article 
      ref={innerRef}
      className={`ranking-row ${mine ? "is-mine" : ""} ${highlight ? "animate-rank-pulse" : ""}`}
    >
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
