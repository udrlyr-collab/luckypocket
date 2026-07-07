import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatCompactMoney } from "../utils/format";
import { PageContainer, SectionHeader, BaseCard, MoneyText, EmptyState, LoadingCard } from "../components/ui";

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
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState("current");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
    api("/seasons")
      .then((seasonData) => setSeasons(seasonData.seasons || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    const endpoint =
      selectedSeason === "current"
        ? `/leaderboard?date=${date}&period=${period}&type=${type}`
        : `/leaderboard?season=${selectedSeason}&type=${type}`;
    api(endpoint)
      .then(setData)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [date, period, type, selectedSeason, user.balance]);

  const podium = data.rankings.slice(0, 3);
  const remaining = data.rankings.slice(3);
  const selectDate = (nextDate, nextPeriod = "day") => {
    setDate(nextDate);
    setPeriod(nextPeriod);
  };
  const periodLabel =
    period === "week" ? "이번 주" : period === "month" ? "이번 달" : date === today ? "오늘" : date;

  return (
    <PageContainer>
      <SectionHeader title="행운주머니 리더보드" eyebrow="LEADERBOARD" className="mb-4" />

      <section className="mb-6">
        <div className="sticky top-[72px] z-20 bg-base-100/90 backdrop-blur-md py-2 mb-3">
          <div className="tabs-boxed grid grid-cols-3 rounded-2xl p-1 bg-base-200/50">
            {Object.entries(rankingTypes).map(([key, tab]) => (
              <button
                type="button"
                key={key}
                className={`btn btn-sm h-10 min-h-10 rounded-xl border-none ${type === key ? "bg-base-100 text-primary shadow-sm font-black" : "bg-transparent text-base-content/60"}`}
                onClick={() => setType(key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select select-bordered h-10 min-h-10 rounded-xl text-sm font-bold"
            value={selectedSeason}
            onChange={(event) => {
              setSelectedSeason(event.target.value);
              setIsDateFilterOpen(false);
            }}
            aria-label="시즌 선택"
          >
            <option value="current">현재 시즌</option>
            {seasons
              .filter((season) => season.status === "ended")
              .map((season) => (
                <option key={season.id} value={season.seasonNumber}>
                  시즌 {season.seasonNumber}
                </option>
              ))}
          </select>
          {selectedSeason === "current" ? (
            <>
              <span className="badge badge-primary badge-outline font-bold h-7">{periodLabel} 기준</span>
              <span className="text-sm text-base-content/60 tabular-nums">{date}</span>
              <button className="btn btn-xs btn-ghost rounded-lg" onClick={() => setIsDateFilterOpen(v => !v)}>
                날짜 변경 {isDateFilterOpen ? "▲" : "▼"}
              </button>
            </>
          ) : (
            <span className="badge badge-secondary badge-outline font-bold h-7">
              종료 시즌 최종 순위
            </span>
          )}
        </div>

        {selectedSeason === "current" && isDateFilterOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-base-200/40">
            <input
              type="date"
              className="input input-sm input-bordered h-10 min-h-10 rounded-xl w-36 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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

      {error ? (
        <div className="alert alert-error mt-5 rounded-3xl min-h-12">
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-4 mt-5">
          <LoadingCard />
          <LoadingCard />
        </div>
      ) : (
        <div className="ranking-transition pb-20">
          <div className="mb-4">
            <h2 className="text-xl font-black">{selected.title}</h2>
            <p className="text-sm text-base-content/60 mt-1">{selected.description}</p>
          </div>
          {podium.length > 0 && (
            <section className="podium-grid mb-6" aria-label="상위 3명">
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
            <BaseCard className="p-0 sm:p-0 overflow-hidden">
              <div className="divide-y divide-base-200">
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
              </div>
            </BaseCard>
          )}

          {data.rankings.length === 0 && (
            <EmptyState message="아직 순위에 표시할 주머니가 없어요." className="mt-8" />
          )}
        </div>
      )}

      {data.myRank && (
        <button
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 btn btn-primary min-h-12 rounded-full shadow-lg px-6 font-bold"
          onClick={scrollToMyRank}
        >
          내 순위 보기
        </button>
      )}
    </PageContainer>
  );
}

function DateButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`btn h-10 min-h-10 px-4 rounded-xl border-0 font-bold ${active ? "btn-primary" : "bg-base-100 text-base-content/70 hover:bg-base-200"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function primaryValue(ranking, type) {
  if (type === "achievements") return `${ranking.achievementCount.toLocaleString("ko-KR")}개 달성`;
  if (type === "games") return `${ranking.totalGames.toLocaleString("ko-KR")}판`;
  return <MoneyText value={ranking.balance} compact />;
}

function secondaryStats(ranking, type) {
  if (type === "achievements") {
    return [
      ["현재 자산", formatCompactMoney(ranking.balance)],
      ["게임", `${ranking.totalGames.toLocaleString("ko-KR")}판`],
      ["파산 횟수", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
    ];
  }
  if (type === "games") {
    return [
      ["현재 자산", formatCompactMoney(ranking.balance)],
      ["업적", `${ranking.achievementCount.toLocaleString("ko-KR")}개`],
      ["파산 횟수", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
    ];
  }
  return [
    ["업적", `${ranking.achievementCount.toLocaleString("ko-KR")}개`],
    ["게임", `${ranking.totalGames.toLocaleString("ko-KR")}판`],
    ["파산 횟수", `${ranking.bankruptcyCount.toLocaleString("ko-KR")}회`],
  ];
}

function PodiumCard({ ranking, type, place, mine, innerRef, highlight }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <article 
      ref={innerRef}
      className={`podium-card place-${place} rounded-3xl border shadow-sm p-5 ${mine ? "border-primary bg-primary/5" : "border-base-200 bg-base-100"} ${highlight ? "animate-rank-pulse ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-3xl drop-shadow-sm" aria-label={`${place}위`}>{medals[place - 1]}</span>
        {mine && <span className="badge badge-primary badge-sm font-black border-0">나</span>}
      </div>
      <span className="mt-4 block truncate text-base font-black text-base-content/70">{ranking.nickname}</span>
      <strong className="block mt-1 text-2xl font-black text-primary tabular-nums">{primaryValue(ranking, type)}</strong>
      <div className="mt-4 flex flex-wrap gap-2">
        {secondaryStats(ranking, type).map(([label, value]) => (
          <span className="rounded-xl bg-base-200/50 px-2 py-1 text-[11px] font-bold text-base-content/60" key={label}>
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
      className={`flex items-center gap-4 p-4 sm:p-5 transition-colors ${mine ? "bg-primary/5" : "hover:bg-base-200/30"} ${highlight ? "animate-rank-pulse bg-primary/10" : ""}`}
    >
      <span className="w-8 text-center text-lg font-black text-base-content/40">{ranking.rank}</span>
      <div className="min-w-0 flex-1">
        <strong className="block truncate font-black text-base">
          {ranking.nickname}
          {mine && <span className="badge badge-primary badge-xs ml-2 border-0">나</span>}
        </strong>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-base-content/50">
          {secondaryStats(ranking, type).map(([label, value]) => (
            <span key={label}>{label} {value}</span>
          ))}
        </div>
      </div>
      <strong className="text-right text-lg font-black tabular-nums">{primaryValue(ranking, type)}</strong>
    </article>
  );
}
