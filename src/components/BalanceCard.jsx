import { formatMoney, formatSignedMoney } from "../utils/format";
import { BaseCard } from "../components/ui";
import AnimatedMoney from "./AnimatedMoney";

export default function BalanceCard({ user, compact = false }) {
  const todayProfit = Number(user.todayProfit || 0);
  if (compact) {
    return (
      <div className="rounded-2xl bg-base-100 px-3 py-1.5 text-right shadow-sm sm:px-4">
        <div>
          <span className="mr-2 hidden text-[10px] text-base-content/60 sm:inline">총평가금액</span>
          <strong className="tabular-nums text-sm sm:text-base">
            <AnimatedMoney value={user.totalEvaluatedAsset} className="text-primary" />
          </strong>
        </div>
        <div className={`hidden text-[10px] font-bold tabular-nums sm:block ${todayProfit >= 0 ? "text-success" : "text-error"}`}>
          {todayProfit >= 0 ? "오늘 수익 " : "오늘 손실 "}
          {formatSignedMoney(todayProfit)}
        </div>
      </div>
    );
  }

  return (
    <BaseCard className=" overflow-hidden bg-gradient-to-br from-pink-100 via-base-100 to-sky-100">
      <div className="relative z-10">
        <p className="mb-1 text-sm font-bold text-base-content/55">총평가금액</p>
        <p className="money-hero">
          <AnimatedMoney value={user.totalEvaluatedAsset} className="text-primary" />
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="mini-stat">
            <span>{todayProfit >= 0 ? "오늘 수익" : "오늘 손실"}</span>
            <strong className={todayProfit >= 0 ? "text-success" : "text-error"}>
              {formatSignedMoney(todayProfit)}
            </strong>
          </div>
          <div className="mini-stat">
            <span>최고 총평가금액</span>
            <strong>{formatMoney(user.highestTotalEvaluatedAsset)}</strong>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute -right-6 -top-8 text-8xl opacity-10">🍀</div>
    </BaseCard>
  );
}
