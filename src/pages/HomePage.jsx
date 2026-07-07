import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import HistoryList from "../components/HistoryList";
import NewsModal from "../components/NewsModal";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import { 
  PageContainer, 
  SectionHeader, 
  BaseCard, 
  StatCard, 
  MoneyText, 
  ChangeText 
} from "../components/ui";

export default function HomePage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
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

  useEffect(() => {
    Promise.all([api("/logs"), api("/games/daily-jackpot")])
      .then(([logData, jackpotDataResult]) => {
        setLogs(logData.logs.slice(0, 5));
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
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">오늘은 행운주머니가 얼마나 불어날까요?</h1>
      </div>
      
      <section className="mb-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="flex flex-col gap-6">
          <BaseCard className="flex flex-col justify-between bg-gradient-to-br from-base-100 to-base-200">
            <div className="flex items-center gap-4 mb-6">
              <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-3xl shadow-inner">👛</div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black tracking-widest text-primary/80 uppercase">행운주머니가 이만큼 자랐어요</p>
                <h2 className="mt-1 text-xl font-bold truncate">{user.nickname}님의 주머니</h2>
              </div>
            </div>
            
            <div className="mb-6">
              <span className="text-xs font-bold text-base-content/50">총 평가 자산</span>
              <strong className="mt-1 block text-4xl sm:text-5xl font-black tracking-tight text-primary tabular-nums break-words" style={{wordBreak: "break-all"}}>
                <MoneyText value={user.totalAsset || user.balance} />
              </strong>
              <div className="mt-2 text-sm">
                오늘 손익 <ChangeText amount={todayProfit} />
              </div>
            </div>

            {isLowBalance && (
              <div className="relative z-10 flex items-center justify-between rounded-2xl bg-error/15 p-4 shadow-inner">
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-black text-error-content/90">자산이 50만원 미만으로 떨어졌어요.</span>
                  <span className="mt-0.5 block truncate text-xs font-bold text-error-content/70">탄광에서 자원을 캐서 다시 모아볼까요?</span>
                </div>
                <button onClick={() => navigate("/mine")} className="btn btn-sm btn-error shrink-0 rounded-xl px-4 font-bold text-xs shadow-sm ml-4 min-h-10">
                  ⛏ 탄광가기
                </button>
              </div>
            )}
          </BaseCard>

          <BaseCard className="home-welcome-card p-6 overflow-hidden relative">
            <div className="relative z-10 max-w-md">
              <span className="badge border-0 bg-base-100/70 font-black text-primary">TODAY&apos;S LUCK</span>
              <h2 className="mt-4 text-2xl font-black leading-tight">
                숫자를 고르고,<br />
                <span className="text-primary">행운을 톡톡</span> 키워보세요
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-base-content/60">
                다섯 가지 게임에서 오늘의 감각을 시험해 보세요.
              </p>
              <Link to="/games/dart" className="btn btn-primary mt-5 h-12 min-h-12 whitespace-nowrap rounded-2xl px-6">
                🎯 다트부터 시작하기
              </Link>
            </div>
            <span className="home-welcome-emoji" aria-hidden="true">🍀</span>
          </BaseCard>
        </div>

        <div className="flex flex-col gap-6">
          <BaseCard className="flex flex-col">
            <SectionHeader title="오늘의 행운 소식" eyebrow="LUCKY NEWS" className="mb-4" />
            
            {latestNews ? (
              <div className="mt-2 min-w-0 border-l-4 border-primary/40 pl-4 py-1 flex-1">
                <strong className="block text-base">{latestNews.title}</strong>
                <p className="mt-2 text-sm leading-relaxed text-base-content/60">{latestNews.message}</p>
                {latestNews.amount > 0 && (
                  <span className={`mt-2 block text-sm font-black tabular-nums ${latestNews.type === "jackpot" ? "text-warning" : "text-success"}`}>
                    <MoneyText value={latestNews.amount} />
                  </span>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-6">
                <p className="text-sm text-base-content/50 text-center">아직 행운 소식이 없어요.<br/>첫 번째 큰 행운을 만들어보세요!</p>
              </div>
            )}
            
            <button 
              type="button" 
              className="btn btn-outline min-h-12 rounded-2xl mt-6 w-full"
              onClick={() => setShowNewsModal(true)}
            >
              행운소식 전체 보기
            </button>
          </BaseCard>

          {jackpotData && (
            <BaseCard variant="highlight" className="bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-950/20 dark:to-purple-950/20 border-indigo-200/50 dark:border-indigo-900/50">
              <div className="flex justify-between items-start mb-4">
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
              
              <div className="rounded-2xl bg-white/60 dark:bg-black/20 p-4 border border-indigo-50 dark:border-indigo-900/30 mb-3">
                <span className="text-xs font-bold text-indigo-900/60 dark:text-indigo-200/60">누적 상금 금액</span>
                <strong className="mt-1 block text-2xl font-black text-warning tabular-nums">
                  <MoneyText value={jackpotData.jackpotPool || 0} />
                </strong>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-2xl bg-white/60 dark:bg-black/20 p-3">
                  <span className="text-[11px] font-bold text-indigo-900/60 dark:text-indigo-200/60">보유 행운권</span>
                  <strong className="mt-1 block text-sm font-black text-secondary tabular-nums">
                    {(jackpotData.myTickets || 0).toLocaleString("ko-KR")}장
                  </strong>
                </div>
                <div className="rounded-2xl bg-white/60 dark:bg-black/20 p-3">
                  <span className="text-[11px] font-bold text-indigo-900/60 dark:text-indigo-200/60">오늘 응모</span>
                  <strong className="mt-1 block text-sm font-black text-primary tabular-nums">
                    {(jackpotData.appliedTickets || 0).toLocaleString("ko-KR")}장
                  </strong>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary min-h-12 w-full rounded-2xl border-none bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 shadow-md shadow-indigo-500/20"
                disabled={jackpotBusy || jackpotData.myTickets <= 0}
                onClick={applyJackpot}
              >
                {jackpotBusy ? <span className="loading loading-spinner loading-sm" /> : "응모하기"}
              </button>
              <p className="mt-3 text-[10px] font-bold text-indigo-900/50 dark:text-indigo-200/50 text-center">
                {jackpotMessage || "행운권 1장당 0.1%씩 가중치가 올라갑니다."}
              </p>
            </BaseCard>
          )}

          {serverStats && (
            <div className="text-center">
              <p className="text-xs font-bold text-base-content/40 leading-relaxed">
                지금까지 {serverStats.totalUsers.toLocaleString("ko-KR")}명이 주머니를 만들었고,<br />
                오늘 {serverStats.activeUsersToday.toLocaleString("ko-KR")}명이 {serverStats.totalGames.toLocaleString("ko-KR")}판의 게임을 즐겼어요!
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader title="미니 게임" eyebrow="PLAY" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(gameMeta).map(([key, game]) => (
            <Link key={key} to={game.path} className="game-card group shadow-sm bg-base-100 rounded-3xl p-5 border border-base-200 transition hover:border-primary/30">
              <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 ${game.color}`}>
                {game.icon}
              </div>
              <h3 className="font-black text-lg">{game.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-base-content/55">{game.summary}</p>
              <span className="mt-5 inline-block text-sm font-black text-primary">게임 열기 →</span>
            </Link>
          ))}
          <Link to="/mine" className="game-card group shadow-sm bg-success/10 border-success/20 rounded-3xl p-5 transition hover:border-success/50">
            <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 bg-success/20 text-success`}>
              ⛏
            </div>
            <h3 className="font-black text-lg text-success-content">탄광에서 자원 캐기</h3>
            <p className="mt-2 text-xs leading-relaxed text-success-content/70">곡괭이를 들고 돌, 석탄, 금, 다이아몬드를 찾아보세요.</p>
            <span className="mt-5 inline-block text-sm font-black text-success">탄광가기 →</span>
          </Link>
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader 
          title="최근 기록" 
          eyebrow="RECENT" 
          rightContent={<Link className="link link-primary text-sm font-bold" to="/history">모두 보기</Link>}
        />
        <BaseCard className="p-0 sm:p-0 overflow-hidden bg-transparent border-0 shadow-none">
           <HistoryList logs={logs} />
        </BaseCard>
      </section>

      {showNewsModal && (
        <NewsModal 
          notifications={notifications} 
          onClose={() => setShowNewsModal(false)} 
        />
      )}
    </PageContainer>
  );
}
