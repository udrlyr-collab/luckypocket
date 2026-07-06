import { useEffect, useState } from "react";
import { api } from "../api/client";
import HistoryList from "../components/HistoryList";
import { gameMeta } from "../data/games";

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
    <div className="page-content">
      <p className="eyebrow">My game log</p>
      <h1 className="text-3xl font-black">최근 활동 기록</h1>
      <p className="mt-2 text-sm text-base-content/55">서버에 저장된 게임과 주요 자산 이벤트를 표시해요.</p>
      <div className="my-6 flex gap-2 overflow-x-auto pb-2">
        <button className={`btn btn-sm rounded-xl ${!filter ? "btn-primary" : "bg-base-100"}`} onClick={() => setFilter("")}>전체</button>
        {Object.entries(gameMeta).map(([key, game]) => (
          <button
            key={key}
            className={`btn btn-sm shrink-0 rounded-xl ${filter === key ? "btn-primary" : "bg-base-100"}`}
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
          ["stock_buy", "📈 주식 매수"],
          ["stock_sell", "📉 주식 매도"],
          ["stock_position_open", "🔥 레버리지 진입"],
          ["stock_position_close", "💰 포지션 청산"],
          ["stock_liquidation", "💀 강제 청산"],
          ["stock_acquire_company", "🏢 회사 인수"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn btn-sm shrink-0 rounded-xl ${filter === key ? "btn-primary" : "bg-base-100"}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? <div className="loading-block" /> : <HistoryList logs={logs} />}
    </div>
  );
}
