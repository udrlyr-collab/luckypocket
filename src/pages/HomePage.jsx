import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import AnimatedMoney from "../components/AnimatedMoney";
import HistoryList from "../components/HistoryList";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import { formatMoney, formatSignedMoney, formatCompactMoney } from "../utils/format";
import { useEnterConfirm } from "../hooks/useEnterConfirm";

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [serverStats, setServerStats] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNewsModal, setShowNewsModal] = useState(false);

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
      Promise.all([api("/server/stats"), api("/server/notifications?limit=50")])
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

  const todayProfit = Number(user.todayProfit || 0);
  const isLowBalance = user.balance < 500000;
  const latestNews = notifications[0];

  return (
    <div className="page-content">
      {/* Hero Card */}
      <section className="mb-8 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="balance-summary-card m-0! shadow-md">
          <div className="balance-summary-owner">
            <span className="balance-summary-pouch" aria-hidden="true">👛</span>
            <div className="min-w-0">
              <p className="text-xs font-black text-primary/80">행운주머니가 이만큼 자랐어요</p>
              <h2 className="mt-1 truncate text-base font-black">{user.nickname}님의 주머니</h2>
            </div>
          </div>
          <div className="balance-summary-main border-b-0 pb-0">
            <span className="summary-label">현재 자산</span>
            <strong className="balance-summary-amount">
              <AnimatedMoney value={user.balance} />
            </strong>
            <span className={`mt-2 inline-flex items-center gap-1 text-sm font-black tabular-nums ${todayProfit >= 0 ? "text-success" : "text-error"}`}>
              {todayProfit >= 0 ? "↗" : "↘"} 오늘 손익 {formatSignedMoney(todayProfit)}
            </span>
          </div>
          {isLowBalance && (
            <div className="relative z-10 mt-2 flex items-center justify-between rounded-xl bg-error/15 p-3 shadow-inner">
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-black text-error-content/90">자산이 부족해졌어요.</span>
                <span className="mt-0.5 block truncate text-[11px] font-bold text-error-content/60">탄광에서 자원을 캐서 다시 모아볼까요?</span>
              </div>
              <button onClick={() => navigate("/mine")} className="btn btn-sm btn-error shrink-0 rounded-xl px-4 font-bold text-[11px] shadow-sm">
                ⛏ 탄광가기
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="soft-card flex-1 p-5 shadow-sm">
            <p className="text-xs font-black tracking-widest text-primary">LUCKY NEWS</p>
            <h3 className="mt-1 text-lg font-black">오늘의 행운 소식</h3>
            {latestNews ? (
              <div className="mt-3 min-w-0 border-l-2 border-primary/30 pl-3">
                <strong className="block text-sm">{latestNews.title}</strong>
                <p className="mt-1 text-xs leading-relaxed text-base-content/60">{latestNews.message}</p>
                {latestNews.amount > 0 && (
                  <span className={`mt-1 block text-xs font-black tabular-nums ${latestNews.type === "jackpot" ? "text-warning" : "text-success"}`}>
                    {formatMoney(latestNews.amount)}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-base-content/50">아직 행운 소식이 없어요.<br/>첫 번째 큰 행운을 만들어보세요!</p>
            )}
            <button 
              type="button" 
              className="btn btn-outline btn-sm rounded-xl mt-4 w-full"
              onClick={() => setShowNewsModal(true)}
            >
              행운소식 전체 보기
            </button>
            {serverStats && (
              <p className="mt-4 text-[11px] font-bold text-base-content/50">
                지금까지 {serverStats.totalUsers.toLocaleString("ko-KR")}명이 주머니를 만들었고,<br />
                오늘 {serverStats.activeUsersToday.toLocaleString("ko-KR")}명이 {serverStats.totalGames.toLocaleString("ko-KR")}판의 게임을 즐겼어요!
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Welcome & Top 3 Section */}
      <div className="mb-4">
        <h1 className="text-2xl font-black sm:text-3xl">오늘은 행운주머니가 얼마나 불어날까요?</h1>
      </div>
      <section className="mb-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="home-welcome-card shadow-md">
          <div className="relative z-10 max-w-md">
            <span className="badge border-0 bg-base-100/70 font-black text-primary">TODAY&apos;S LUCK</span>
            <h2 className="mt-4 text-2xl font-black leading-tight sm:text-3xl">
              숫자를 고르고,<br />
              <span className="text-primary">행운을 톡톡</span> 키워보세요
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-base-content/60">
              다섯 가지 게임에서 오늘의 감각을 시험해 보세요.
            </p>
            <Link to="/games/dart" className="btn btn-primary mt-5 h-12 whitespace-nowrap rounded-2xl px-6">
              🎯 다트부터 시작하기
            </Link>
          </div>
          <span className="home-welcome-emoji" aria-hidden="true">🍀</span>
        </div>
        
        <div className="soft-card flex flex-col shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">현재 자산 TOP 3</h2>
            <Link className="link link-primary text-xs font-bold" to="/ranking">전체 랭킹</Link>
          </div>
          <div className="flex-1 space-y-2">
            {rankings.map((ranking, index) => (
              <div className="flex items-center gap-3 rounded-xl bg-base-200/60 p-3" key={ranking.userId}>
                <span className="grid size-8 place-items-center rounded-full bg-warning/30 font-black text-[13px]">
                  {index + 1}
                </span>
                <strong className="flex-1 truncate text-sm">{ranking.nickname}</strong>
                <span className="text-[13px] font-black tabular-nums text-primary">{formatCompactMoney(ranking.balance)}</span>
              </div>
            ))}
            {!rankings.length && <div className="empty-state py-6">첫 랭커가 되어 보세요!</div>}
          </div>
        </div>
      </section>

      {/* Game List */}
      <section className="mt-8">
        <div className="mb-4">
          <p className="eyebrow">Pick a game</p>
          <h2 className="section-title text-xl">게임 목록</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(gameMeta).map(([key, game]) => (
            <Link key={key} to={game.path} className="game-card group shadow-sm">
              <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 ${game.color}`}>
                {game.icon}
              </div>
              <h3 className="font-black">{game.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-base-content/55">{game.summary}</p>
              <span className="mt-5 inline-block text-sm font-black text-primary">게임 열기 →</span>
            </Link>
          ))}
          <Link to="/mine" className="game-card group shadow-sm bg-success/10 border-success/20">
            <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 bg-success/20 text-success`}>
              ⛏
            </div>
            <h3 className="font-black text-success-content">탄광에서 자원 캐기</h3>
            <p className="mt-2 text-xs leading-relaxed text-success-content/70">곡괭이를 들고 돌, 석탄, 금, 다이아몬드를 찾아보세요.</p>
            <span className="mt-5 inline-block text-sm font-black text-success">탄광가기 →</span>
          </Link>
        </div>
      </section>

      {/* History */}
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

      {showNewsModal && (
        <NewsModal 
          notifications={notifications} 
          onClose={() => setShowNewsModal(false)} 
        />
      )}
    </div>
  );
}

function NewsModal({ notifications, onClose }) {
  const timeLabel = (value) =>
    new Intl.DateTimeFormat("ko-KR", { 
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" 
    }).format(new Date(value));

  useEnterConfirm(true, onClose);

  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box rounded-[2rem] max-h-[80vh] flex flex-col p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black">최근 행운소식</h2>
          <button type="button" className="btn btn-circle btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
          {notifications.map((news) => (
            <div key={news.id} className="bg-base-200/50 rounded-2xl p-4">
              <strong className="block text-sm mb-1">{news.title}</strong>
              <div className="text-xs text-base-content/80 leading-relaxed">
                {news.message}
              </div>
              <div className="text-[10px] text-base-content/50 mt-2">
                {timeLabel(news.createdAt)}
              </div>
            </div>
          ))}
          {!notifications.length && (
            <p className="text-sm text-center py-10 text-base-content/50">
              아직 행운소식이 없어요.<br/>첫 번째 큰 행운을 만들어보세요!
            </p>
          )}
        </div>
      </div>
      <button className="modal-backdrop" type="button" aria-label="닫기" onClick={onClose} />
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
