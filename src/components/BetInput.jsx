import { useMemo, useState } from "react";
import { formatMoney } from "../utils/format";

const ADD_AMOUNTS = [10000, 100000, 1000000, 5000000];
const RATIOS = [0.01, 0.05, 0.1, 0.2, 0.5];

function numericValue(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

export default function BetInput({ balance, value, onChange, disabled = false, eventCap = false }) {
  const [popping, setPopping] = useState(false);
  const amount = numericValue(value);
  const ratioCap = Math.floor(balance * 0.5);
  const maximum = Math.min(ratioCap, eventCap ? 100000 : Number.POSITIVE_INFINITY);
  const formatted = amount ? amount.toLocaleString("ko-KR") : "";
  const validation = useMemo(() => {
    if (amount > 0 && amount < 1000) return "최소 배팅금은 1,000원이에요.";
    if (amount > maximum) return `현재 최대 배팅금은 ${formatMoney(Math.max(0, maximum))}이에요.`;
    return "";
  }, [amount, maximum]);

  const animateChange = (nextAmount) => {
    onChange(String(Math.max(0, Math.floor(nextAmount))));
    setPopping(false);
    window.requestAnimationFrame(() => setPopping(true));
    window.setTimeout(() => setPopping(false), 220);
  };

  const setAdd = (addition) => {
    animateChange(Math.min(maximum, amount + addition));
  };

  const setQuick = (ratio) => {
    animateChange(Math.min(maximum, Math.floor(balance * ratio)));
  };

  const handleInput = (event) => {
    const next = numericValue(event.target.value);
    onChange(String(Math.min(balance, next)));
  };

  return (
    <div className="soft-card bet-amount-card min-w-0">
      <div className="mb-4 flex items-start justify-between gap-3">
        <label htmlFor="bet-amount" className="text-base font-black">
          배팅할 금액
        </label>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-right text-[11px] font-black text-primary">
          최대 {formatMoney(Math.max(0, maximum))}
        </span>
      </div>
      <div className={`join flex h-15 w-full ${popping ? "bet-pop" : ""}`}>
        <input
          id="bet-amount"
          className="input input-bordered join-item h-15 min-w-0 flex-1 px-5 text-right text-2xl font-black tabular-nums"
          type="text"
          inputMode="numeric"
          pattern="[0-9,]*"
          value={formatted}
          disabled={disabled}
          onChange={handleInput}
          placeholder="0"
          aria-describedby="bet-help bet-validation"
        />
        <span className="join-item flex min-w-14 items-center justify-center border border-base-300 bg-base-200 px-4 font-black">
          원
        </span>
      </div>
      <div className="quick-amount-grid mt-4">
        {ADD_AMOUNTS.map((addition) => (
          <button
            type="button"
            className="btn quick-amount-btn rounded-2xl bg-base-200 whitespace-nowrap"
            key={addition}
            disabled={disabled || maximum < 1000}
            onClick={() => setAdd(addition)}
          >
            +{addition.toLocaleString("ko-KR")}
          </button>
        ))}
        {RATIOS.map((ratio) => (
          <button
            type="button"
            className="btn quick-amount-btn rounded-2xl bg-base-200 whitespace-nowrap"
            key={ratio}
            disabled={disabled || maximum < 1000}
            onClick={() => setQuick(ratio)}
          >
            {ratio * 100}%
          </button>
        ))}
        <button
          type="button"
          className="btn quick-amount-btn rounded-2xl border-primary/20 bg-primary/5 whitespace-nowrap text-primary"
          disabled={disabled}
          onClick={() => animateChange(0)}
        >
          초기화
        </button>
      </div>
      <p id="bet-help" className="mt-2 text-xs text-base-content/50">
        최소 1,000원 · 현재 자산의 최대 50%
        {eventCap ? " · 이 선택지는 최대 100,000원" : ""}
      </p>
      <p id="bet-validation" className="mt-1 min-h-4 text-xs font-bold text-error">
        {validation}
      </p>
    </div>
  );
}
