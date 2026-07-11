import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { gameMeta } from "../data/games";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatSignedMoney,
} from "../utils/format";
import {
  PageContainer,
  SectionHeader,
  BaseCard,
  StatCard,
  MoneyText,
  ChangeText,
  ConfirmModal,
} from "../components/ui";

import AssetChart from "../components/AssetChart";
import RecentAssetEvents from "../components/RecentAssetEvents";

const rangeTabs = [
  { key: "day", label: "하루" },
  { key: "week", label: "일주일" },
  { key: "month", label: "한달" },
];

const fallbackGameMeta = {
  title: "기타 기록",
  icon: "🎲",
  color: "bg-base-200",
};

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeFormatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDate(value);
}

export default function ProfilePage() {
  const { user, logout, refreshUser } = useAuth();
  const [summary, setSummary] = useState(null);
  const [gameStats, setGameStats] = useState([]);
  const [seasonResults, setSeasonResults] = useState([]);
  const [luckStats, setLuckStats] = useState(null);
  const [stockStats, setStockStats] = useState(null);
  const [range, setRange] = useState("day");
  const [scaleMode, setScaleMode] = useState("zoom");
  const [history, setHistory] = useState(null);
  
  const [newNickname, setNewNickname] = useState("");
  const [nicknameMessage, setNicknameMessage] = useState("");
  const [nicknameError, setNicknameError] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  
  const [bankruptcyBusy, setBankruptcyBusy] = useState(false);
  const [bankruptcyMessage, setBankruptcyMessage] = useState("");
  const [showBankruptcyConfirm, setShowBankruptcyConfirm] = useState(false);

  const achievements = user.achievements || [];

  const loadProfile = async () => {
    const [summaryData, statsData, seasonData, luckData, stockStatsData] = await Promise.all([
      api("/profile/summary"),
      api("/profile/game-stats"),
      api("/me/season-results"),
      api("/me/luck-stats"),
      api("/profile/stock-stats"),
    ]);
    setSummary(summaryData.summary);
    setGameStats(statsData.stats);
    setSeasonResults(seasonData.results || []);
    setLuckStats(luckData.luckStats || null);
    setStockStats(stockStatsData.stats || null);
  };

  useEffect(() => {
    loadProfile().catch(() => {});
  }, [user.balance]);

  useEffect(() => {
    api(`/profile/asset-history?range=${range}`).then(setHistory).catch(() => {});
  }, [range, user.balance]);

  const changeNickname = async () => {
    setNicknameBusy(true);
    setNicknameMessage("");
    setNicknameError("");
    try {
      const data = await api("/profile/nickname", {
        method: "PATCH",
        body: JSON.stringify({ newNickname }),
      });
      setNicknameMessage(data.message);
      setNewNickname("");
      await refreshUser();
      await loadProfile();
    } catch (error) {
      setNicknameError(error.message);
    } finally {
      setNicknameBusy(false);
    }
  };

  const applyBankruptcy = async () => {
    setShowBankruptcyConfirm(false);
    setBankruptcyBusy(true);
    setBankruptcyMessage("");
    try {
      const data = await api("/bankruptcy/apply", { method: "POST" });
      setBankruptcyMessage(data.message);
      await refreshUser();
      await loadProfile();
    } catch (error) {
      setBankruptcyMessage(error.message);
    } finally {
      setBankruptcyBusy(false);
    }
  };

  return (
    <PageContainer>
      <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{user.nickname}님의 행운주머니</h1>
          <p className="mt-2 text-sm text-base-content/60">@{user.username} · 가입 {safeFormatDate(user.createdAt)}</p>
        </div>
        <button className="btn btn-outline min-h-12 rounded-2xl w-full md:w-auto" onClick={logout}>
          로그아웃
        </button>
      </div>

      {summary && (
        <section className="mb-8">
          <SectionHeader title="핵심 요약" eyebrow="SUMMARY" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="현재 자산" value={<MoneyText value={summary.balance} />} />
            <StatCard label="최고 자산" value={<MoneyText value={summary.highestBalance} />} />
            <StatCard label="총 수익" value={<MoneyText value={summary.grossProfit} />} valueClassName="text-success" />
            <StatCard label="총 손실" value={<MoneyText value={summary.grossLoss} />} valueClassName="text-error" />
            <StatCard label="순수익" value={<ChangeText amount={summary.netGameProfit} />} />
            <StatCard label="총 게임횟수" value={`${safeNumber(summary.totalGames).toLocaleString("ko-KR")}판`} />
            <StatCard label="획득 업적" value={`${safeNumber(summary.achievementCount).toLocaleString("ko-KR")}개`} />
            <StatCard label="총 획득 금액" value={<MoneyText value={summary.totalPayout} />} />
            <StatCard label="총 잃은 금액" value={<MoneyText value={summary.totalLostAmount} />} />
            <StatCard label="누적 파산 횟수" value={`${safeNumber(summary.bankruptcyCount).toLocaleString("ko-KR")}회`} />
          </div>
        </section>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <BaseCard className="flex flex-col justify-between">
          <div>
            <SectionHeader title="닉네임 변경" eyebrow="NICKNAME" className="mb-2" />
            <p className="text-sm text-base-content/60 mb-1">
              현재 닉네임: <strong className="text-primary">{user.nickname}</strong>
            </p>
            <p className={`text-xs font-black ${user.nicknameChangeCount === 0 ? "text-success" : "text-error"}`}>
              {user.nicknameChangeCount === 0 ? "최초 1회 무료 변경 가능" : "변경 비용 500,000원 필요"}
            </p>
          </div>
          <div className="mt-4">
            <div className="flex flex-col items-stretch gap-2 sm:flex-row">
              <input
                className="input input-bordered w-full min-h-12 rounded-2xl"
                value={newNickname}
                maxLength="12"
                onChange={(event) => setNewNickname(event.target.value)}
                placeholder="새 닉네임 2~12자"
              />
              <button
                type="button"
                className="btn btn-primary min-h-12 shrink-0 whitespace-nowrap rounded-2xl px-6"
                disabled={nicknameBusy || !newNickname.trim() || (user.nicknameChangeCount >= 1 && user.balance < 500000)}
                onClick={changeNickname}
              >
                {nicknameBusy ? <span className="loading loading-spinner loading-sm" /> : "변경"}
              </button>
            </div>
            <div className="min-h-6 mt-1 text-sm font-bold">
              <span className={nicknameError ? "text-error" : "text-success"}>{nicknameError || nicknameMessage || ""}</span>
            </div>
          </div>
        </BaseCard>

        <BaseCard className="flex flex-col justify-between">
          <div>
            <SectionHeader title="재도전 지원" eyebrow="RECOVERY" className="mb-2" />
            <p className="text-sm text-base-content/60 mb-4">
              자산이 부족할 때 다시 일어설 수 있도록 지원합니다.
            </p>
          </div>
          
          <div className="flex flex-col gap-3">
            <Link to="/mine" className="flex items-center justify-between rounded-2xl bg-success/10 p-4 border border-success/20 transition hover:border-success/50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⛏</span>
                <div>
                  <strong className="block text-success-content">탄광에서 자원 캐기</strong>
                  <span className="text-xs text-success-content/70">자산을 직접 캐서 모아보세요.</span>
                </div>
              </div>
              <span className="btn btn-sm btn-success rounded-xl font-bold min-h-10 text-white">탄광가기</span>
            </Link>

            {user.balance < 500000 && (
              <div className="flex items-center justify-between rounded-2xl bg-warning/10 p-4 border border-warning/30">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🌱</span>
                  <div>
                    <strong className="block text-warning-content">파산신청으로 시작</strong>
                    <span className="text-xs text-warning-content/70">1,000,000원으로 리셋됩니다.</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowBankruptcyConfirm(true)}
                  disabled={bankruptcyBusy}
                  className="btn btn-sm btn-warning rounded-xl font-bold min-h-10 text-white"
                >
                  {bankruptcyBusy ? <span className="loading loading-spinner loading-sm" /> : "파산신청"}
                </button>
              </div>
            )}
            {bankruptcyMessage && <div className="text-xs font-bold text-error mt-1">{bankruptcyMessage}</div>}
          </div>
        </BaseCard>
      </section>

      {luckStats && (
        <section className="mb-8">
          <SectionHeader title="나의 행운 통계" eyebrow="LUCK STATS" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="가장 많이 한 게임"
              value={luckStats.mostPlayedGame ? `${luckStats.mostPlayedGame.label} ${safeNumber(luckStats.mostPlayedGame.count).toLocaleString("ko-KR")}판` : "-"}
            />
            <StatCard
              label="가장 잘 번 게임"
              value={luckStats.mostEarnedGame ? `${luckStats.mostEarnedGame.label} · ${formatMoney(luckStats.mostEarnedGame.amount)}` : "-"}
              valueClassName="text-success"
            />
            <StatCard
              label="최고 단일 수익"
              value={luckStats.bestSingleProfit ? `${luckStats.bestSingleProfit.label} · ${formatSignedMoney(luckStats.bestSingleProfit.amount)}` : "-"}
              valueClassName="text-success"
            />
            <StatCard
              label="최고 주식 수익"
              value={luckStats.bestStockProfit ? `${luckStats.bestStockProfit.name} · ${formatSignedMoney(luckStats.bestStockProfit.amount)}` : "-"}
              valueClassName="text-success"
            />
            <StatCard
              label="가장 많이 잃은 게임"
              value={luckStats.mostLostGame ? `${luckStats.mostLostGame.label} · ${formatMoney(luckStats.mostLostGame.amount)}` : "-"}
              valueClassName="text-error"
            />
            <StatCard
              label="최대 단일 손실"
              value={luckStats.worstSingleLoss ? `${luckStats.worstSingleLoss.label} · ${formatSignedMoney(luckStats.worstSingleLoss.amount)}` : "-"}
              valueClassName="text-error"
            />
            <StatCard
              label="최대 주식 손실"
              value={luckStats.worstStockLoss ? `${luckStats.worstStockLoss.name} · ${formatSignedMoney(luckStats.worstStockLoss.amount)}` : "-"}
              valueClassName="text-error"
            />
            <StatCard
              label="잭팟 응모 / 당첨"
              value={`${safeNumber(luckStats.jackpotEntries).toLocaleString("ko-KR")}장 / ${safeNumber(luckStats.jackpotWins).toLocaleString("ko-KR")}회`}
            />
          </div>
        </section>
      )}

      {stockStats && (
        <section className="mb-8">
          <SectionHeader title="주식 거래 통계" eyebrow="STOCK STATS" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label="현물 거래" value={`${safeNumber(stockStats.spotTradeCount).toLocaleString("ko-KR")}회`} />
            <StatCard label="레버리지 진입" value={`${safeNumber(stockStats.leverageOpenCount).toLocaleString("ko-KR")}회`} />
            <StatCard label="레버리지 직접 청산" value={`${safeNumber(stockStats.leverageCloseCount).toLocaleString("ko-KR")}회`} />
            <StatCard label="강제 청산" value={`${safeNumber(stockStats.leverageLiquidationCount).toLocaleString("ko-KR")}회`} />
            <StatCard label="완료 포지션" value={`${safeNumber(stockStats.leverageRoundTripCount).toLocaleString("ko-KR")}회`} />
            <StatCard label="총 주식 거래 행동" value={`${safeNumber(stockStats.totalStockTradeActions).toLocaleString("ko-KR")}회`} valueClassName="text-primary" />
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionHeader title="이전 시즌 기록" eyebrow="SEASON" />
        <BaseCard className="p-0 sm:p-0 overflow-hidden bg-transparent border-0 shadow-none">
          <div className="grid gap-3 lg:grid-cols-2">
            {seasonResults.slice(0, 8).map((row) => (
              <BaseCard key={row.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-base-200">
                <div className="flex items-center gap-3">
                  <span className="badge badge-primary badge-outline font-black whitespace-nowrap">
                    시즌 {row.seasonNumber}
                  </span>
                  <div>
                    <strong className="block text-lg font-black tabular-nums">
                      {safeNumber(row.rank).toLocaleString("ko-KR")}위
                    </strong>
                    <span className="text-xs text-base-content/50">
                      게임 {safeNumber(row.totalGames).toLocaleString("ko-KR")}판
                    </span>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <span className="block text-xs font-bold text-base-content/50">최종 평가 자산</span>
                  <strong className="font-black text-primary text-lg tabular-nums">
                    <MoneyText value={row.finalTotalEvaluatedAsset} />
                  </strong>
                </div>
              </BaseCard>
            ))}
            {seasonResults.length === 0 && (
              <div className="col-span-full rounded-3xl bg-base-200 p-8 text-center text-sm font-bold text-base-content/50">
                아직 종료된 시즌 기록이 없습니다.
              </div>
            )}
          </div>
        </BaseCard>
      </section>

      <section className="mb-8">
        <BaseCard className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <SectionHeader title="재산 변화 그래프" eyebrow="ASSET HISTORY" className="mb-0" />
            <div className="join shrink-0">
              {rangeTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  className={`btn min-h-10 h-10 join-item ${range === tab.key ? "btn-primary" : "bg-base-200"}`}
                  onClick={() => setRange(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          
          {history ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
                <StatCard label="시작 자산" value={<MoneyText value={history.startBalance} compact />} />
                <StatCard label="마지막 자산" value={<MoneyText value={history.endBalance} compact />} />
                <StatCard label="변화량" value={<ChangeText amount={history.change} />} />
                <StatCard 
                  label="변화율" 
                  value={`${history.startBalance > 0 && history.change >= 0 ? "+" : ""}${history.startBalance > 0 ? ((history.change / history.startBalance) * 100).toFixed(2) : "0.00"}%`} 
                  valueClassName={history.change >= 0 ? "text-success" : "text-error"} 
                />
              </div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-base-content/50">그래프 뷰 모드</span>
                <div className="rounded-2xl bg-base-200 p-1 flex">
                  {[["zoom", "변화 확대"], ["full", "전체 보기"]].map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      className={`rounded-xl px-4 py-2 text-xs font-black whitespace-nowrap transition ${scaleMode === key ? "bg-base-100 text-primary shadow-sm" : "text-base-content/50"}`}
                      onClick={() => setScaleMode(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <AssetChart points={history.points} range={range} scaleMode={scaleMode} />
              <div className="mt-6">
                <RecentAssetEvents points={history.points} range={range} />
              </div>
            </>
          ) : (
            <div className="animate-pulse h-64 bg-base-200 rounded-2xl w-full" />
          )}
        </BaseCard>
      </section>

      <section className="mb-8">
        <SectionHeader title="게임별 통계" eyebrow="STATISTICS" />
        <div className="grid gap-4 lg:grid-cols-2">
          {gameStats.map((stat) => {
            const meta = gameMeta[stat.gameType] || {
              ...fallbackGameMeta,
              title: stat.gameType || fallbackGameMeta.title,
            };
            return (
              <BaseCard key={stat.gameType}>
                <div className="mb-5 flex items-center gap-4">
                  <div className={`grid size-12 place-items-center rounded-2xl text-2xl ${meta.color}`}>{meta.icon}</div>
                  <div>
                    <h3 className="font-black text-lg">{meta.title}</h3>
                    <p className="text-xs font-bold text-base-content/50">승률 {formatPercent(stat.winRate)}</p>
                  </div>
                  <strong className="ml-auto text-primary font-black tabular-nums">{stat.totalGames}판</strong>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="승/패" value={`${stat.wins} / ${stat.losses}`} />
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="총 배팅금" value={<MoneyText value={stat.totalBet} compact />} />
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="얻은 금액" value={<MoneyText value={stat.totalPayout} compact />} />
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="잃은 금액" value={<MoneyText value={stat.lostAmount} compact />} />
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="최고 획득" value={<MoneyText value={stat.maxPayout} compact />} />
                  <StatCard className="bg-transparent border-0 p-0 shadow-none" label="순수익" value={<ChangeText amount={stat.netProfit} />} />
                </div>
              </BaseCard>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <div className="flex justify-between items-end mb-6">
          <SectionHeader title="업적 수집함" eyebrow="ACHIEVEMENTS" className="mb-0" />
          <span className="text-sm font-bold tabular-nums">
            {achievements.filter((item) => item.unlockedAt).length} / {achievements.length}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((achievement) => (
            <div
              className={`rounded-3xl p-5 border shadow-sm flex flex-col gap-3 ${achievement.unlockedAt ? "border-warning/30 bg-warning/10" : "border-base-200 bg-base-100 opacity-60"}`}
              key={achievement.key}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-2xl bg-base-100 text-xl shadow-sm">
                  {achievement.unlockedAt ? "🏅" : "🔒"}
                </span>
                <h3 className="font-black leading-tight">{achievement.title}</h3>
              </div>
              <p className="text-xs text-base-content/60 leading-relaxed">{achievement.description}</p>
              <div className="mt-auto pt-2 text-right">
                <strong className={`text-sm tabular-nums ${achievement.unlockedAt ? "text-warning-content" : "text-base-content/40"}`}>
                  <MoneyText value={achievement.reward} />
                </strong>
              </div>
            </div>
          ))}
        </div>
      </section>

      {user.username === "admin" && (
        <section className="mt-12 pt-8 border-t-2 border-dashed border-error/20">
          <SectionHeader title="관리자 전용 기능" eyebrow="ADMIN ONLY" />
          <BaseCard variant="error" className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <strong className="block text-error-content font-black text-lg">서버 관리자 패널</strong>
              <p className="text-sm text-error-content/70 mt-1">유저 데이터 수정 및 주식장/시즌 제어 기능을 제공합니다.</p>
            </div>
            <Link to="/admin" className="btn btn-error min-h-12 rounded-2xl w-full sm:w-auto font-bold px-8">
              관리자 페이지로 이동
            </Link>
          </BaseCard>
        </section>
      )}

      <ConfirmModal
        isOpen={showBankruptcyConfirm}
        title="파산신청을 진행할까요?"
        message="파산신청 시 현재 보유한 모든 현금이 1,000,000원으로 초기화됩니다. 이 작업은 되돌릴 수 없습니다."
        onConfirm={applyBankruptcy}
        onCancel={() => setShowBankruptcyConfirm(false)}
        confirmText="파산신청"
        isDanger={true}
        isBusy={bankruptcyBusy}
      />
    </PageContainer>
  );
}
