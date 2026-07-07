import { Link } from "react-router-dom";
import { formatMoney, formatPercent } from "../utils/format";
import { PageContainer, SectionHeader } from "./ui";

export function GameShell({ icon, title, description, stats, betAmount = 0, children }) {
  const multiplierValue =
    stats?.multiplierLabel || `${stats?.multiplier.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}배`;
  const expectedValue =
    stats?.expectedLabel ||
    `+${((stats?.chance * stats?.multiplier - 1) * 100).toFixed(2)}%`;

  return (
    <PageContainer>
      <Link to="/" className="btn btn-outline min-h-10 h-10 mb-6 rounded-xl font-bold px-4">
        ← 홈으로 돌아가기
      </Link>
      <div className="flex items-start gap-4 mb-6">
        <div className="grid size-16 shrink-0 place-items-center rounded-3xl bg-base-100 border border-base-200 text-4xl shadow-sm">
          {icon}
        </div>
        <div>
          <SectionHeader title={title} eyebrow="MINI GAME" className="mb-2" />
          <p className="text-sm text-base-content/60 leading-relaxed">{description}</p>
        </div>
      </div>
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="성공 확률" value={formatPercent(stats.chance)} />
          <Stat label="총 지급 배당" value={multiplierValue} />
          <Stat label="기대 순이익" value={expectedValue} accent />
          <Stat
            label="예상 획득 금액"
            value={stats.multiplierLabel ? "결과별" : formatMoney(betAmount * stats.multiplier)}
          />
        </div>
      )}
      {children}
    </PageContainer>
  );
}

export function Stat({ label, value, accent = false }) {
  return (
    <div className="rounded-2xl bg-base-100 p-3 text-center shadow-sm">
      <div className="text-[11px] font-bold text-base-content/50">{label}</div>
      <div className={`mt-1 text-sm font-black tabular-nums sm:text-lg ${accent ? "text-success" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function ErrorAlert({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="alert alert-error mt-4 rounded-2xl text-sm">
      <span>⚠️</span>
      <span>{message}</span>
    </div>
  );
}
