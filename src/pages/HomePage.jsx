import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import HistoryList from "../components/HistoryList";
import NewsModal from "../components/NewsModal";
import AnimatedMoney from "../components/AnimatedMoney";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import { 
  PageContainer, 
  SectionHeader, 
  BaseCard, 
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
  const [marketMovers, setMarketMovers] = useState({ gainers: [], losers: [] });
  const [dailyMissions, setDailyMissions] = useState([]);
  const [suspendedGames, setSuspendedGames] = useState({});
  const previousJackpotAmount = useRef(null);
  const [jackpotAddedAmount, setJackpotAddedAmount] = useState(0);

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
    let active = true;
    const loadJackpot = () => Promise.all([api("/logs"), api("/games/daily-jackpot")])
      .then(([logData, jackpotDataResult]) => {
        if (!active) return;
        setLogs(logData.logs.slice(0, 5));
        setJackpotData(jackpotDataResult);
      })
      .catch(() => {});
    loadJackpot();
    const timer = window.setInterval(loadJackpot, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user.balance]);

  useEffect(() => {
    const currentAmount = Number(jackpotData?.jackpotPool || 0);
    const previousAmount = previousJackpotAmount.current;
    previousJackpotAmount.current = currentAmount;
    if (previousAmount === null || currentAmount <= previousAmount) return undefined;

    setJackpotAddedAmount(currentAmount - previousAmount);
    const timer = window.setTimeout(() => setJackpotAddedAmount(0), 2_000);
    return () => window.clearTimeout(timer);
  }, [jackpotData?.jackpotPool]);

  useEffect(() => {
    let active = true;
    const loadServerNews = () =>
      Promise.all([
        api("/server/stats"),
        api("/server/notifications?limit=50"),
        api("/stocks/market-movers"),
        api("/me/daily-missions"),
        api("/games/status"),
      ])
        .then(([stats, news, movers, missions, gameStatus]) => {
          if (!active) return;
          setServerStats(stats);
          setNotifications(news.notifications);
          setMarketMovers(movers || { gainers: [], losers: [] });
          setDailyMissions(missions.missions || []);
          setSuspendedGames(gameStatus.suspended || {});
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
  const isLowBalance = user.assetValuationComplete !== false && user.totalEvaluatedAsset < 500000;
  const latestNewsItems = notifications.slice(0, 2);
  const quickGameEntries = ["risk-button", "bomb-dodge", "slot", "cup", "timing"]
    .map((key) => [key, gameMeta[key]])
    .filter(([, game]) => Boolean(game));
  const completedMissionCount = dailyMissions.filter((mission) => mission.completed).length;
  const claimableMissions = dailyMissions.filter((mission) => mission.completed && !mission.claimed);
  const topGainer = marketMovers.gainers?.[0];
  const topLoser = marketMovers.losers?.[0];
  const formatRate = (value) => `${value >= 0 ? "+" : ""}${(Number(value || 0) * 100).toFixed(1)}%`;

  const applyJackpot = async () => {
    setJackpotBusy(true);
    setJackpotMessage("");
    try {
      const data = await api("/games/daily-jackpot/apply", { method: "POST" });
      setJackpotMessage(data.message);
      setJackpotData((current) => current ? {
        ...current,
        myTickets: 0,
        appliedTickets: data.totalApplied,
        totalAppliedTickets: data.jackpotInfo?.totalExtraEntries || data.totalAppliedTickets,
        totalParticipants: data.jackpotInfo?.totalEffectiveEntries || data.totalParticipants,
      } : current);
      await refreshUser();
    } catch (error) {
      setJackpotMessage(error.message);
    } finally {
      setJackpotBusy(false);
    }
  };

  const claimMission = async (missionId) => {
    try {
      const data = await api(`/me/daily-missions/${missionId}/claim`, { method: "POST" });
      setDailyMissions(data.missions || []);
      await refreshUser();
    } catch (error) {
      setJackpotMessage(error.message);
    }
  };

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">오늘은 행운주머니가 얼마나 불어날까요?</h1>
      </div>
      
      <section className="mb-8 grid gap-6 lg:grid-cols-3">
        <BaseCard className="order-1 flex min-h-[13rem] flex-col justify-center overflow-hidden rounded-3xl border border-base-300 bg-gradient-to-br from-base-100 via-base-100 to-primary/5 p-5 shadow-sm sm:p-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <div className="flex items-start gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-3xl bg-primary/10 text-3xl shadow-inner">👛</div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-primary/80">
                행운주머니가 자랐어요
              </p>
              <h2 className="mt-2 truncate text-2xl font-black">{user.nickname}님의 주머니</h2>
            </div>
          </div>

          <div className="mt-5">
            <span className="text-xs font-black text-base-content/50">총평가금액</span>
            <strong className={`mt-1 block max-w-full text-4xl font-black leading-none tracking-tight tabular-nums sm:text-5xl ${user.assetValuationComplete === false ? "text-error" : "text-primary"}`}>
              {user.assetValuationComplete === false
                ? "평가 오류"
                : <MoneyText value={user.totalEvaluatedAsset} className="break-words" />}
            </strong>
            {user.assetValuationComplete === false && (
              <p className="mt-2 text-xs font-bold text-error">일부 보유 자산의 정상 평가 가격을 확인할 수 없습니다.</p>
            )}
            <div className="mt-3 text-base font-black">
              오늘 손익 <ChangeText amount={todayProfit} />
            </div>
          </div>

          {isLowBalance && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-error/15 p-3 shadow-inner">
              <span className="min-w-0 text-xs font-black text-error-content/90">
                자산이 50만원 미만이에요.
              </span>
              <button onClick={() => navigate("/mine")} className="btn btn-xs btn-error min-h-9 shrink-0 rounded-xl px-3">
                ⛏ 탄광
              </button>
            </div>
          )}
        </BaseCard>

        <BaseCard className="order-2 flex min-h-[13rem] flex-col rounded-3xl border border-base-300 p-5 shadow-sm sm:p-6 lg:col-span-1 lg:col-start-3 lg:row-start-1">
          <SectionHeader title="오늘의 행운 소식" eyebrow="LUCKY NEWS" className="mb-3" />

          {latestNewsItems.length > 0 ? (
            <div className="grid flex-1 gap-3">
              {latestNewsItems.map((item) => (
                <div key={item.id} className="min-w-0 border-l-4 border-primary/35 py-1 pl-4">
                  <strong className="block truncate text-sm">{item.title}</strong>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-base-content/60">
                    {item.message}
                  </p>
                  {item.amount > 0 && (
                    <span className={`mt-1 block text-xs font-black tabular-nums ${item.type === "jackpot" ? "text-warning" : "text-success"}`}>
                      <MoneyText value={item.amount} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-4">
              <p className="text-center text-sm text-base-content/50">
                아직 행운 소식이 없어요.
              </p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-outline mt-4 min-h-11 w-full rounded-2xl"
            onClick={() => setShowNewsModal(true)}
          >
            행운소식 전체 보기
          </button>
        </BaseCard>

          <BaseCard className="order-3 home-welcome-card relative flex min-h-[18rem] items-center overflow-hidden rounded-3xl border border-base-300 p-5 shadow-sm sm:p-6 lg:col-span-1 lg:col-start-1 lg:row-start-2">
            <div className="relative z-10 max-w-sm">
              <span className="badge border-0 bg-base-100/70 font-black text-primary">TODAY&apos;S LUCK</span>
              <h2 className="mt-4 text-2xl font-black leading-tight">
                숫자를 고르고,<br />
                <span className="text-primary">행운을 톡톡</span> 키워보세요
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-base-content/60">
                오늘은 다트로 가볍게 시작해 보세요.
              </p>
              <Link to="/games/dart" className="btn btn-primary mt-5 h-12 min-h-12 whitespace-nowrap rounded-2xl px-6">
                🎯 다트부터 시작하기
              </Link>
            </div>
          </BaseCard>

          <BaseCard className="order-4 flex min-h-[18rem] flex-col rounded-3xl border border-base-300 bg-gradient-to-br from-base-100 to-secondary/5 p-5 shadow-sm sm:p-6 lg:col-span-1 lg:col-start-2 lg:row-start-2">
            <SectionHeader title="빠른 플레이" eyebrow="QUICK PLAY" className="mb-3" />
            <p className="text-sm font-bold leading-relaxed text-base-content/60">
              오늘 바로 즐길 수 있는 인기 게임으로 이동하세요.
            </p>
            <div className="mt-4 grid gap-2">
              {quickGameEntries.map(([key, game]) => (
                <Link
                  key={key}
                  to={game.path}
                  className="flex items-center justify-between rounded-2xl border border-base-300 bg-base-100/80 px-4 py-3 text-sm font-black transition hover:border-primary/40"
                >
                  <span>{game.icon} {game.title}</span>
                  <span className="text-primary">열기 →</span>
                </Link>
              ))}
            </div>
            {serverStats && (
              <p className="mt-auto pt-4 text-xs font-bold leading-relaxed text-base-content/45">
                지금까지 {serverStats.totalUsers.toLocaleString("ko-KR")}명이 주머니를 만들었고,
                오늘 {serverStats.activeUsersToday.toLocaleString("ko-KR")}명이 플레이했어요.
              </p>
            )}
          </BaseCard>

        {jackpotData && (
          <BaseCard variant="warning" className="order-5 flex min-h-[27rem] flex-col rounded-3xl border border-warning/30 bg-gradient-to-br from-warning/10 via-base-100 to-primary/10 p-5 shadow-sm sm:p-6 lg:col-span-1 lg:col-start-3 lg:row-start-2">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-warning">DAILY JACKPOT</p>
                <h3 className="mt-1 text-lg font-black text-base-content">오늘의 잭팟</h3>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-black text-base-content/50">추첨까지 남은 시간</span>
                <strong className="block text-sm font-black text-primary tabular-nums">
                  {timeUntilMidnight}
                </strong>
              </div>
            </div>

            <div className="mb-3 rounded-2xl border border-warning/20 bg-base-100 p-4 shadow-inner">
              <span className="text-xs font-bold text-base-content/55">누적 상금 금액</span>
              <strong className="mt-1 block text-2xl font-black text-warning tabular-nums">
                <AnimatedMoney value={jackpotData.jackpotPool || 0} />
                {jackpotAddedAmount > 0 && (
                  <span className="ml-2 inline-block animate-bounce text-xs text-success">
                    +{jackpotAddedAmount.toLocaleString("ko-KR")}원
                  </span>
                )}
              </strong>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-base-300/60 bg-base-100/80 p-3">
                <span className="text-[11px] font-bold text-base-content/55">보유 행운권</span>
                <strong className="mt-1 block text-sm font-black text-secondary tabular-nums">
                  {(jackpotData.myTickets || 0).toLocaleString("ko-KR")}장
                </strong>
              </div>
              <div className="rounded-2xl border border-base-300/60 bg-base-100/80 p-3">
                <span className="text-[11px] font-bold text-base-content/55">오늘 응모</span>
                <strong className="mt-1 block text-sm font-black text-primary tabular-nums">
                  {(jackpotData.appliedTickets || 0).toLocaleString("ko-KR")}장
                </strong>
              </div>
              <div className="col-span-2 rounded-2xl border border-warning/20 bg-base-100/80 p-3">
                <span className="text-[11px] font-bold text-base-content/55">전체 응모 수</span>
                <strong className="mt-1 block text-sm font-black text-warning tabular-nums">
                  {(jackpotData.totalParticipants || 0).toLocaleString("ko-KR")}장
                </strong>
                <span className="mt-1 block text-[10px] font-bold text-base-content/45">
                  모든 플레이어는 기본 1장씩 자동 응모돼요.
                </span>
              </div>
            </div>

            <div className="mt-auto">
              <button
                type="button"
                className="btn btn-primary min-h-12 w-full rounded-2xl shadow-sm"
                disabled={jackpotBusy || jackpotData.myTickets <= 0}
                onClick={applyJackpot}
              >
                {jackpotBusy ? <span className="loading loading-spinner loading-sm" /> : "응모하기"}
              </button>
              <p className="mt-3 min-h-4 text-center text-[10px] font-bold text-base-content/50">
                {jackpotMessage || "자정에 오늘의 잭팟이 추첨돼요."}
              </p>
            </div>
          </BaseCard>
        )}
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <BaseCard className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
          <SectionHeader title="오늘의 시장" eyebrow="MARKET" className="mb-4" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-success/10 p-4">
              <p className="text-xs font-black text-success">최고 상승</p>
              {topGainer ? (
                <>
                  <strong className="mt-2 block truncate text-lg font-black">{topGainer.name}</strong>
                  <span className="mt-1 block text-sm font-black text-success tabular-nums">
                    {formatRate(topGainer.changeRate)}
                  </span>
                </>
              ) : (
                <p className="mt-2 text-sm font-bold text-base-content/50">상승 종목이 없습니다.</p>
              )}
            </div>
            <div className="rounded-2xl bg-error/10 p-4">
              <p className="text-xs font-black text-error">최대 하락</p>
              {topLoser ? (
                <>
                  <strong className="mt-2 block truncate text-lg font-black">{topLoser.name}</strong>
                  <span className="mt-1 block text-sm font-black text-error tabular-nums">
                    {formatRate(topLoser.changeRate)}
                  </span>
                </>
              ) : (
                <p className="mt-2 text-sm font-bold text-base-content/50">하락 종목이 없습니다.</p>
              )}
            </div>
          </div>
          <Link to="/stocks" className="btn btn-outline mt-4 min-h-11 w-full rounded-2xl">
            주식 시장 보기
          </Link>
        </BaseCard>

        <BaseCard className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
          <SectionHeader
            title="오늘의 미션"
            eyebrow="DAILY"
            rightContent={
              <span className="text-xs font-black text-primary">
                {completedMissionCount}/{dailyMissions.length || 0}
              </span>
            }
            className="mb-4"
          />
          <div className="grid gap-2">
            {dailyMissions.slice(0, 4).map((mission) => (
              <div key={mission.id} className="flex items-center justify-between gap-3 rounded-2xl bg-base-200/45 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{mission.title}</p>
                  <p className="text-xs font-bold text-base-content/50 tabular-nums">
                    {mission.progressCount}/{mission.targetCount}
                  </p>
                </div>
                {mission.claimed ? (
                  <span className="badge badge-success badge-outline shrink-0">수령 완료</span>
                ) : mission.completed ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-xs min-h-8 shrink-0 rounded-xl"
                    onClick={() => claimMission(mission.id)}
                  >
                    보상 받기
                  </button>
                ) : (
                  <span className="badge badge-outline shrink-0">진행 중</span>
                )}
              </div>
            ))}
            {dailyMissions.length === 0 && (
              <p className="rounded-2xl bg-base-200/45 p-4 text-sm font-bold text-base-content/50">
                미션 정보를 불러오는 중입니다.
              </p>
            )}
          </div>
          {claimableMissions.length > 0 && (
            <p className="mt-3 text-xs font-bold text-primary">
              수령 가능한 보상 {claimableMissions.length}개가 있습니다.
            </p>
          )}
        </BaseCard>
      </section>

      <section className="mb-8">
        <SectionHeader title="미니 게임" eyebrow="PLAY" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(gameMeta).map(([key, game]) => {
            const isSuspended = suspendedGames[key] === true;
            return (
              <div
                key={key}
                onClick={() => {
                  if (isSuspended) {
                    alert("이 미니게임은 점검 및 정지 상태입니다. 관리자 제어 해제 후 이용해 주세요.");
                  } else {
                    navigate(game.path);
                  }
                }}
                className={`game-card group shadow-sm bg-base-100 rounded-3xl p-5 border border-base-200 transition hover:border-primary/30 cursor-pointer ${
                  isSuspended ? "opacity-50" : ""
                }`}
              >
                <div className={`mb-4 grid size-14 place-items-center rounded-2xl text-3xl transition group-hover:-translate-y-1 ${game.color}`}>
                  {game.icon}
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-lg">{game.title}</h3>
                  {isSuspended && (
                    <span className="badge badge-error badge-xs font-black text-white rounded-lg px-1 py-0.5">정지됨</span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-base-content/55">{game.summary}</p>
                <span className="mt-5 inline-block text-sm font-black text-primary">
                  {isSuspended ? "점검 중" : "게임 열기 →"}
                </span>
              </div>
            );
          })}
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
