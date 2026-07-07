import { gameMeta } from "../data/games";
import { formatDate, formatMoney, formatSignedMoney } from "../utils/format";

function eventMeta(log) {
  if (log.entryType === "transfer_out") {
    return {
      icon: "💸",
      title: `${log.detail.otherNickname}님에게 ${formatMoney(log.lossAmount)}을 보냈어요`,
      color: "bg-error/15",
      badge: "badge-error",
    };
  }
  if (log.entryType === "transfer_in") {
    return {
      icon: "💌",
      title: `${log.detail.otherNickname}님에게 ${formatMoney(log.payout)}을 받았어요`,
      color: "bg-success/15",
      badge: "badge-success",
    };
  }
  if (log.entryType === "bonus_code") {
    return {
      icon: "🎁",
      title: `행운코드로 ${formatMoney(log.payout)}을 받았어요`,
      color: "bg-warning/25",
      badge: "badge-warning",
    };
  }
  if (log.entryType === "nickname_change_fee") {
    return {
      icon: "✏️",
      title: `닉네임 변경 비용 ${formatMoney(log.lossAmount)}을 사용했어요`,
      color: "bg-error/10",
      badge: "badge-error",
    };
  }
  if (log.entryType === "nickname_change") {
    return {
      icon: "✏️",
      title: "첫 닉네임을 무료로 변경했어요",
      color: "bg-primary/10",
      badge: "badge-primary",
      badgeLabel: "무료 변경",
    };
  }
  if (log.entryType === "achievement_reward") {
    return {
      icon: "🏅",
      title: log.detail.title || "업적 보상",
      color: "bg-warning/25",
      badge: "badge-warning",
    };
  }
  if (log.entryType === "support_grant") {
    return {
      icon: "🌱",
      title: "행운주머니 지원금",
      color: "bg-primary/15",
      badge: "badge-primary",
    };
  }
  if (log.entryType === "bankruptcy_reset") {
    return {
      icon: "🌱",
      title: "파산신청으로 자산이 1,000,000원으로 재설정되었어요",
      color: "bg-warning/20",
      badge: "badge-warning",
      badgeLabel: "파산신청",
    };
  }
  if (log.entryType === "admin_nickname_change") {
    return {
      icon: "🛡️",
      title: "닉네임이 관리자에 의해 변경되었어요",
      color: "bg-primary/15",
      badge: "badge-primary",
      badgeLabel: "관리자",
    };
  }
  if (log.entryType === "server_notification") {
    return {
      icon: "📣",
      title: log.detail.message || log.detail.title || "서버 알림",
      color: "bg-secondary/20",
      badge: "badge-secondary",
      badgeLabel: "서버 알림",
    };
  }
  if (log.entryType === "daily_lossback") {
    return {
      icon: "🩹",
      title: "오늘 조금 운이 없었네요. 작은 회복 보너스를 받았어요.",
      color: "bg-success/15",
      badge: "badge-success",
      badgeLabel: "손실 보전",
    };
  }
  if (log.entryType === "luck_ticket_use") {
    return {
      icon: "🎟️",
      title: "행운권을 사용했어요. 이 판은 보상이 조금 더 좋아졌어요.",
      color: "bg-secondary/20",
      badge: "badge-secondary",
      badgeLabel: "행운권",
    };
  }
  if (log.entryType === "jackpot_pool_reward") {
    return {
      icon: "🎊",
      title: "서버 잭팟이 터졌어요!",
      color: "bg-warning/25",
      badge: "badge-warning",
      badgeLabel: "서버 잭팟",
    };
  }
  if (log.entryType === "stock_buy") {
    return {
      icon: "📈",
      title: `주식을 ${formatMoney(Math.abs(log.profit))}에 매수했어요`,
      color: "bg-primary/15",
      badge: "badge-primary",
      badgeLabel: "현물 매수",
    };
  }
  if (log.entryType === "stock_sell") {
    return {
      icon: "📉",
      title: `주식을 매도하여 ${formatMoney(log.profit)}을 받았어요`,
      color: "bg-success/15",
      badge: "badge-success",
      badgeLabel: "현물 매도",
    };
  }
  if (log.entryType === "stock_position_open") {
    return {
      icon: "🔥",
      title: `레버리지 증거금 ${formatMoney(Math.abs(log.profit))}을 사용했어요`,
      color: "bg-primary/20",
      badge: "badge-primary",
      badgeLabel: "롱 진입",
    };
  }
  if (log.entryType === "stock_position_close") {
    return {
      icon: "💰",
      title: `포지션을 청산하고 ${formatMoney(log.profit)}을 돌려받았어요`,
      color: "bg-success/20",
      badge: "badge-success",
      badgeLabel: "포지션 청산",
    };
  }
  if (log.entryType === "stock_liquidation") {
    return {
      icon: "💀",
      title: `포지션이 강제 청산되어 증거금을 잃었어요`,
      color: "bg-error/20",
      badge: "badge-error",
      badgeLabel: "강제청산",
    };
  }
  if (log.entryType === "stock_acquire_company") {
    return {
      icon: "🏢",
      title: `회사를 인수하는 데 ${formatMoney(Math.abs(log.profit))}을 사용했어요`,
      color: "bg-secondary/20",
      badge: "badge-secondary",
      badgeLabel: "회사 인수",
    };
  }
  const game = gameMeta[log.gameType];
  return {
    icon: game?.icon || "🍀",
    title: game?.title || log.gameType,
    color: game?.color || "bg-base-200",
    badge: log.result === "win" ? "badge-success" : "badge-error",
  };
}

export default function HistoryList({ logs, emptyText = "아직 게임 기록이 없어요." }) {
  if (!logs?.length) {
    return <div className="empty-state">{emptyText}</div>;
  }
  return (
    <div className="min-w-0 space-y-3">
      {logs.map((log) => {
        const meta = eventMeta(log);
        const isGame = log.entryType === "game";
        const isNonFinancial = ["nickname_change", "admin_nickname_change", "server_notification", "luck_ticket_use"].includes(log.entryType);
        return (
          <article className="min-w-0 rounded-2xl bg-base-100 p-4 shadow-sm" key={log.id}>
            <div className="flex min-w-0 items-center gap-3">
              <div className={`grid size-11 shrink-0 place-items-center rounded-xl text-xl ${meta.color}`}>
                {meta.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-sm">{meta.title}</strong>
                  <span className={`badge badge-sm ${meta.badge}`}>
                    {meta.badgeLabel || (isGame ? (log.result === "win" ? "성공" : "실패") : "보상")}
                  </span>
                </div>
                <time className="mt-1 block text-xs text-base-content/45">{formatDate(log.createdAt)}</time>
              </div>
              {!isNonFinancial && (
                <strong className={`shrink-0 font-black tabular-nums ${log.profit >= 0 ? "text-success" : "text-error"}`}>
                  {formatSignedMoney(log.profit)}
                </strong>
              )}
            </div>
            {!isNonFinancial && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <HistoryValue label="배팅금" value={formatMoney(log.betAmount)} />
                <HistoryValue label="획득 금액" value={formatMoney(log.payout)} />
                <HistoryValue label="손실 금액" value={formatMoney(log.lossAmount || 0)} />
                <HistoryValue label="결과 후 자산" value={formatMoney(log.balanceAfter)} />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function HistoryValue({ label, value }) {
  return (
    <div className="rounded-xl bg-base-200/60 p-2">
      <span className="block text-[10px] text-base-content/45">{label}</span>
      <strong className="mt-1 block truncate tabular-nums">{value}</strong>
    </div>
  );
}
