import { Link } from "react-router-dom";
import { formatMoney, formatPercent } from "../utils/format";

export function GameShell({ icon, title, description, stats, betAmount = 0, children }) {
  const multiplierValue =
    stats?.multiplierLabel || `${stats?.multiplier.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}배`;
  const expectedValue =
    stats?.expectedLabel ||
    `+${((stats?.chance * stats?.multiplier - 1) * 100).toFixed(2)}%`;

  return (
    <div className="page-content">
      <Link to="/" className="btn btn-ghost btn-sm mb-3 -ml-2 rounded-xl">
        ← 홈으로
      </Link>
      <header className="mb-6 flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-base-100 text-3xl shadow-sm">
          {icon}
        </div>
        <div>
          <p className="eyebrow">행운주머니 숫자 게임</p>
          <h1 className="text-2xl font-black sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-base-content/60">{description}</p>
        </div>
      </header>
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
    </div>
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
