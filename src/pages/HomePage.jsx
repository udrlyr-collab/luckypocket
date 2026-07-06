import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import HistoryList from "../components/HistoryList";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import { formatMoney } from "../utils/format";

export default function HomePage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [serverStats, setServerStats] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    Promise.all([api("/logs"), api("/rankings")])
      .then(([logData, rankData]) => {
        setLogs(logData.logs.slice(0, 5));
        setRankings(rankData.rankings.slice(0, 3));
      })
      .catch(() => {});
  }, [user.balance]);

  useEffect(() => {
    let active = true;
    const loadServerNews = () =>
      Promise.all([api("/server/stats"), api("/server/notifications?limit=20")])
        .then(([stats, news]) => {
          if (!active) return;
          setServerStats(stats);
          setNotifications(news.notifications);
        })
        .catch(() => {});
    loadServerNews();
    const timer = window.setInterval(loadServerNews, 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="page-content">
      <div className="mb-6">
        <p className="eyebrow">Hello, {user.nickname}</p>
        <h1 className="text-2xl font-black sm:text-3xl">오늘은 행운주머니가 얼마나 불어날까요?</h1>
        <p className="mt-2 text-sm text-base-content/55">
          배팅할 금액을 정하고, 귀여운 숫자 게임으로 자산을 키워보세요.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="home-welcome-card">
          <div className="relative z-10 max-w-md">
            <span className="badge border-0 bg-base-100/70 font-black text-primary">TODAY&apos;S LUCK</span>
            <h2 className="mt-4 text-2xl font-black leading-tight sm:text-3xl">
              숫자를 고르고,<br />
              <span className="text-primary">행운을 톡톡</span> 키워보세요
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-base-content/60">
              다섯 가지 숫자 게임에서 오늘의 감각을 시험해 보세요.
            </p>
            <Link to="/games/dart" className="btn btn-primary mt-5 h-12 whitespace-nowrap rounded-2xl px-6">
              🎯 다트부터 시작하기
            </Link>
          </div>
          <span className="home-welcome-emoji" aria-hidden="true">🍀</span>
        </section>
        <section className="soft-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">현재 자산 TOP 3</h2>
            <Link className="link link-primary text-xs font-bold" to="/ranking">전체 랭킹</Link>
          </div>
          <div className="space-y-2">
            {rankings.map((ranking, index) => (
              <div className="flex items-center gap-3 rounded-xl bg-base-200/60 p-3" key={ranking.userId}>
                <span className="grid size-8 place-items-center rounded-full bg-warning/30 font-black">
                  {index + 1}
                </span>
                <strong className="flex-1 truncate">{ranking.nickname}</strong>
                <span className="text-sm font-black tabular-nums">{formatMoney(ranking.balance)}</span>
              </div>
            ))}
            {!rankings.length && <div className="empty-state py-6">첫 랭커가 되어 보세요!</div>}
          </div>
        </section>
      </div>

      {serverStats && (
        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="서버 전체 통계">
          <ServerStat label="전체 가입자" value={`${serverStats.totalUsers.toLocaleString("ko-KR")}명`} />
          <ServerStat label="오늘 가입" value={`${serverStats.todayNewUsers.toLocaleString("ko-KR")}명`} />
          <ServerStat label="오늘 활동" value={`${serverStats.activeUsersToday.toLocaleString("ko-KR")}명`} />
          <ServerStat label="누적 게임" value={`${serverStats.totalGames.toLocaleString("ko-KR")}판`} />
        </section>
      )}

      <section className="mt-8">
        <div className="mb-4">
          <p className="eyebrow">Lucky news</p>
          <h2 className="section-title text-xl">행운 소식</h2>
        </div>
        <div className="soft-card max-h-96 space-y-2 overflow-y-auto">
          {notifications.map((notification, index) => (
            <article
              className={`flex items-start gap-3 rounded-2xl bg-base-200/55 p-3 ${index === 0 ? "achievement-pop" : ""}`}
              key={notification.id}
            >
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl text-xl ${notification.type === "jackpot" ? "bg-warning/25" : "bg-success/15"}`}>
                {notification.type === "bankruptcy" ? "🌱" : notification.type === "achievement" ? "🏅" : notification.type === "bonus_code" ? "🎁" : "✨"}
              </span>
              <div className="min-w-0">
                <strong className="block text-sm">{notification.title}</strong>
                <p className="mt-1 text-xs leading-relaxed text-base-content/60">{notification.message}</p>
                {notification.amount > 0 && (
                  <span className={`mt-1 block text-xs font-black tabular-nums ${notification.type === "jackpot" ? "text-warning" : "text-success"}`}>
                    {formatMoney(notification.amount)}
                  </span>
                )}
              </div>
            </article>
          ))}
          {!notifications.length && (
            <div className="empty-state py-8">아직 큰 행운 소식이 없어요.</div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <p className="eyebrow">Pick a game</p>
          <h2 className="section-title text-xl">오늘은 행운주머니가 얼마나 불어날까요?</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(gameMeta).map(([key, game]) => (
            <Link
              key={key}
              to={game.path}
              className="game-card group"
            >
              <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 ${game.color}`}>
                {game.icon}
              </div>
              <h3 className="font-black">{game.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-base-content/55">{game.summary}</p>
              <span className="mt-5 inline-block text-sm font-black text-primary">게임 열기 →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="eyebrow">Recent luck</p>
            <h2 className="section-title text-xl">최근 기록</h2>
          </div>
          <Link className="link link-primary text-xs font-bold" to="/history">20판 모두 보기</Link>
        </div>
        <HistoryList logs={logs} />
      </section>
    </div>
  );
}

function ServerStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-base-300/60 bg-base-100 p-4 text-center shadow-sm">
      <span className="block text-[11px] font-bold text-base-content/45">{label}</span>
      <strong className="mt-1 block tabular-nums">{value}</strong>
    </div>
  );
}
