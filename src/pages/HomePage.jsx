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
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [serverStats, setServerStats] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [jackpotData, setJackpotData] = useState(null);
  const [jackpotBusy, setJackpotBusy] = useState(false);
  const [jackpotMessage, setJackpotMessage] = useState("");
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [timeUntilMidnight, setTimeUntilMidnight] = useState("");

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const nextMidnightKst = new Date(kstNow);
      nextMidnightKst.setUTCHours(24, 0, 0, 0);
      const ms = nextMidnightKst.getTime() - kstNow.getTime();
      const h = Math.floor(ms / (1000 * 60 * 60));
      const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((ms % (1000 * 60)) / 1000);
      setTimeUntilMidnight(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);
  const [showNewsModal, setShowNewsModal] = useState(false);

  useEffect(() => {
    Promise.all([api("/logs"), api("/rankings"), api("/games/daily-jackpot")])
      .then(([logData, rankData, jackpotDataResult]) => {
        setLogs(logData.logs.slice(0, 5));
        setRankings(rankData.rankings.slice(0, 3));
        setJackpotData(jackpotDataResult);
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
  const isLowBalance = (user.totalAsset || user.balance) < 500000;
  const latestNews = notifications[0];

  const applyJackpot = async () => {
    setJackpotBusy(true);
    setJackpotMessage("");
    try {
      const data = await api("/games/daily-jackpot/apply", { method: "POST" });
      setJackpotMessage(data.message);
      setJackpotData((current) => current ? { ...current, myTickets: 0, appliedTickets: data.totalApplied } : current);
      await refreshUser();
    } catch (error) {
      setJackpotMessage(error.message);
    } finally {
      setJackpotBusy(false);
    }
  };

  return (
    <div className="page-content">
      {/* Hero Card */}
      <section className="mb-8 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="soft-card flex flex-col justify-between p-6 shadow-md bg-gradient-to-br from-base-100 to-base-200">
          <div className="flex items-center gap-4 mb-6">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-3xl shadow-inner">👛</div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black tracking-widest text-primary/80 uppercase">행운주머니가 이만큼 자랐어요</p>
              <h2 className="mt-1 text-xl font-black truncate">{user.nickname}님의 주머니</h2>
            </div>
          </div>
          <div className="mb-6">
            <span className="text-xs font-bold text-base-content/50">총 평가 자산</span>
            <strong className="mt-1 block text-4xl font-black tracking-tight text-primary tabular-nums break-words" style={{wordBreak: "break-all"}}>
              <AnimatedMoney value={user.totalAsset || user.balance} />
            </strong>
            <span className={`mt-2 inline-flex items-center gap-1 text-sm font-bold ${todayProfit >= 0 ? "text-success" : "text-error"}`}>
              {todayProfit >= 0 ? "↗" : "↘"} 오늘 손익 {formatSignedMoney(todayProfit)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-base-100 p-4 shadow-sm">
              <span className="text-[11px] font-bold text-base-content/50 flex items-center gap-1">✨ 최고 자산</span>
              <strong className="mt-1 block truncate text-base font-black tabular-nums">{formatMoney(user.highestBalance)}</strong>
            </div>
            <div className="rounded-xl bg-base-100 p-4 shadow-sm">
              <span className="text-[11px] font-bold text-base-content/50 flex items-center gap-1">🏆 내 순위</span>
              <strong className="mt-1 block truncate text-base font-black tabular-nums">{user.currentRank ? `${user.currentRank.toLocaleString("ko-KR")}위` : "-"}</strong>
              {user.totalUsers && <span className="text-[10px] font-bold text-base-content/40 block mt-0.5">전체 {user.totalUsers.toLocaleString("ko-KR")}명</span>}
            </div>
          </div>
          {isLowBalance && (
            <div className="relative z-10 mt-4 flex items-center justify-between rounded-xl bg-error/15 p-3 shadow-inner">
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
          {jackpotData && (
            <div className="soft-card p-5 shadow-sm bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100 dark:border-indigo-900/50">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-black tracking-widest text-indigo-500 uppercase">DAILY JACKPOT</p>
                  <h3 className="mt-1 text-lg font-black text-indigo-950 dark:text-indigo-100">오늘의 잭팟</h3>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-indigo-400">추첨까지 남은 시간</span>
                  <strong className="block text-sm font-black text-indigo-600 dark:text-indigo-300 tabular-nums">
                    {timeUntilMidnight}
                  </strong>
                </div>
              </div>
              
              <div className="mt-4 rounded-2xl bg-white/60 dark:bg-black/20 p-4 border border-indigo-50 dark:border-indigo-900/30">
                <span className="text-xs font-bold text-indigo-900/60 dark:text-indigo-200/60">누적 상금 금액</span>
                <strong className="mt-1 block text-2xl font-black text-warning tabular-nums">
                  {formatMoney(jackpotData.jackpotPool || 0)}
                </strong>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/60 dark:bg-black/20 p-3">
                  <span className="text-[11px] font-bold text-indigo-900/60 dark:text-indigo-200/60">보유 행운권</span>
                  <strong className="mt-1 block text-sm font-black text-secondary tabular-nums">
                    {(jackpotData.myTickets || 0).toLocaleString("ko-KR")}장
                  </strong>
                </div>
                <div className="rounded-2xl bg-white/60 dark:bg-black/20 p-3">
                  <span className="text-[11px] font-bold text-indigo-900/60 dark:text-indigo-200/60">오늘 응모한 행운권</span>
                  <strong className="mt-1 block text-sm font-black text-primary tabular-nums">
                    {(jackpotData.appliedTickets || 0).toLocaleString("ko-KR")}장
                  </strong>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm mt-3 w-full rounded-xl border-none bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-md shadow-indigo-500/20"
                disabled={jackpotBusy || jackpotData.myTickets <= 0}
                onClick={applyJackpot}
              >
                {jackpotBusy ? <span className="loading loading-spinner loading-sm" /> : "응모하기"}
              </button>
              <p className="mt-2 text-[10px] font-bold text-indigo-900/50 dark:text-indigo-200/50 text-center">
                {jackpotMessage || "행운권 1장당 0.1%씩 가중치가 올라갑니다."}
              </p>
            </div>
          )}
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
