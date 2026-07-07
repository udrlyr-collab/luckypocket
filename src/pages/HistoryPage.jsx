import { useEffect, useState } from "react";
import { api } from "../api/client";
import HistoryList from "../components/HistoryList";
import { gameMeta } from "../data/games";
import { PageContainer, SectionHeader, BaseCard, LoadingCard, EmptyState } from "../components/ui";

export default function HistoryPage() {
  const [filter, setFilter] = useState("");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const eventFilters = new Set([
      "transfer_out",
      "transfer_in",
      "bonus_code",
      "nickname_change_fee",
      "nickname_change",
      "achievement_reward",
      "support_grant",
      "bankruptcy_reset",
      "admin_nickname_change",
      "server_notification",
      "daily_lossback",
      "luck_ticket_use",
      "jackpot_pool_reward",
      "stock_buy",
      "stock_sell",
      "stock_position_open",
      "stock_position_close",
      "stock_liquidation",
      "stock_acquire_company",
    ]);
    const query = filter
      ? eventFilters.has(filter)
        ? `?eventType=${filter}`
        : `?gameType=${filter}`
      : "";
    api(`/logs${query}`)
      .then((data) => setLogs(data.logs))
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <PageContainer>
      <SectionHeader title="최근 활동 기록" eyebrow="HISTORY" className="mb-4" />
      <p className="text-sm text-base-content/60 mb-6">
        서버에 저장된 게임과 주요 자산 이벤트를 표시해요.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <button 
          className={`btn btn-sm h-10 min-h-10 px-4 rounded-xl border-none font-bold transition ${!filter ? "btn-primary" : "bg-base-200 text-base-content/60 hover:bg-base-300"}`} 
          onClick={() => setFilter("")}
        >
          전체
        </button>
        {Object.entries(gameMeta).map(([key, game]) => (
          <button
            key={key}
            className={`btn btn-sm h-10 min-h-10 px-4 rounded-xl border-none font-bold transition ${filter === key ? "btn-primary" : "bg-base-200 text-base-content/60 hover:bg-base-300"}`}
            onClick={() => setFilter(key)}
          >
            {game.icon} {game.title}
          </button>
        ))}
        {[
          ["transfer_out", "💸 송금 보냄"],
          ["transfer_in", "💌 송금 받음"],
          ["bonus_code", "🎁 행운코드"],
          ["nickname_change_fee", "✏️ 닉네임 변경"],
          ["nickname_change", "✏️ 무료 닉네임 변경"],
          ["achievement_reward", "🏅 업적 보상"],
          ["support_grant", "🌱 지원금"],
          ["bankruptcy_reset", "🌱 파산신청"],
          ["admin_nickname_change", "🛡️ 관리자 변경"],
          ["server_notification", "📣 서버 알림"],
          ["daily_lossback", "🩹 손실 보전"],
          ["luck_ticket_use", "🎟️ 행운권 사용"],
          ["jackpot_pool_reward", "🎊 서버 잭팟"],
          ["stock_buy", "📈 주식 매수"],
          ["stock_sell", "📉 주식 매도"],
          ["stock_position_open", "🔥 레버리지 진입"],
          ["stock_position_close", "💰 포지션 청산"],
          ["stock_liquidation", "💀 강제 청산"],
          ["stock_acquire_company", "🏢 회사 인수"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn btn-sm h-10 min-h-10 px-4 rounded-xl border-none font-bold transition ${filter === key ? "btn-primary" : "bg-base-200 text-base-content/60 hover:bg-base-300"}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <BaseCard className="p-0 sm:p-0 overflow-hidden">
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            <div className="animate-pulse h-16 bg-base-200 rounded-2xl w-full" />
            <div className="animate-pulse h-16 bg-base-200 rounded-2xl w-full" />
            <div className="animate-pulse h-16 bg-base-200 rounded-2xl w-full" />
          </div>
        ) : logs.length > 0 ? (
          <HistoryList logs={logs} />
        ) : (
          <EmptyState message="해당하는 기록이 없어요." icon="📝" />
        )}
      </BaseCard>
    </PageContainer>
  );
}
