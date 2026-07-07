import AnimatedMoney from "./AnimatedMoney";
import { BaseCard } from "../components/ui";
import { formatMoney, formatSignedMoney } from "../utils/format";

export default function BalanceSummaryCard({ user }) {
  const todayProfit = Number(user.todayProfit || 0);
  const unlocked = (user.achievements || []).filter((achievement) => achievement.unlockedAt).length;

  return (
    <section className="balance-summary-card" aria-label="내 자산 요약">
      <div className="balance-summary-owner">
        <span className="balance-summary-pouch" aria-hidden="true">👛</span>
        <div className="min-w-0">
          <p className="text-xs font-black text-primary/75">행운주머니가 이만큼 자랐어요</p>
          <h2 className="mt-1 text-base font-black break-keep">{user.nickname}님의 주머니</h2>
          <p className="mt-1 text-xs text-base-content/45">
            업적 {unlocked.toLocaleString("ko-KR")}개 수집
          </p>
        </div>
      </div>

      <div className="balance-summary-main">
        <span className="summary-label">총 평가 자산</span>
        <strong className="balance-summary-amount">
          <AnimatedMoney value={user.totalAsset || user.balance} />
        </strong>
        <span className={`mt-2 inline-flex items-center gap-1 text-sm font-black tabular-nums ${todayProfit >= 0 ? "text-success" : "text-error"}`}>
          {todayProfit >= 0 ? "↗" : "↘"} 오늘 손익 {formatSignedMoney(todayProfit)}
        </span>
      </div>

      <div className="balance-summary-metrics">
        <SummaryMetric icon="✨" label="최고 자산" value={formatMoney(user.highestBalance)} />
        <SummaryMetric
          icon="🏆"
          label="내 순위"
          value={user.currentRank ? `${user.currentRank.toLocaleString("ko-KR")}위` : "-"}
          sub={user.totalUsers ? `전체 ${user.totalUsers.toLocaleString("ko-KR")}명` : ""}
        />
      </div>
    </section>
  );
}

function SummaryMetric({ icon, label, value, sub = "" }) {
  return (
    <div className="balance-summary-metric">
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <span className="summary-label">{label}</span>
        <strong className="block truncate text-sm font-black tabular-nums">{value}</strong>
        {sub && <span className="text-[10px] font-bold text-base-content/40">{sub}</span>}
      </div>
    </div>
  );
}
