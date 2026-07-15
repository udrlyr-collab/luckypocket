"use client";
import { FormEvent } from "react";

const indicators = ["current_price", "change_bps", "volume", "sma", "ema", "rsi", "macd", "bollinger_upper", "bollinger_lower", "rolling_high", "rolling_low", "orderbook_imbalance_bps", "position_quantity", "holding_return_bps", "market_regime_strength", "sector_strength"];

export default function VisualStrategyBuilder({ onBuild, disabled }: { onBuild: (value: unknown) => void; disabled: boolean }) {
  function build(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const operand = (prefix: string) => ({ kind: "indicator", indicator: String(form.get(prefix)), period: Number(form.get(`${prefix}Period`)) });
    const action = String(form.get("action"));
    onBuild({ version: 1, when: { mode: form.get("mode"), conditions: [{ left: operand("left"), operator: form.get("operator"), right: operand("right") }] }, then: { type: action, sizing: action === "buy" ? "percent_available_cash" : "percent_position", valueBps: Number(form.get("valueBps")) } });
  }
  return <section className="panel"><h2>시각 전략 빌더</h2><form className="form" onSubmit={build}><div className="form-row"><label>왼쪽 지표<select name="left" defaultValue="ema">{indicators.map((x) => <option key={x}>{x}</option>)}</select></label><label>기간<input name="leftPeriod" type="number" min="1" max="500" defaultValue="5"/></label><label>비교<select name="operator"><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option><option value="neq">≠</option></select></label></div><div className="form-row"><label>오른쪽 지표<select name="right" defaultValue="ema">{indicators.map((x) => <option key={x}>{x}</option>)}</select></label><label>기간<input name="rightPeriod" type="number" min="1" max="500" defaultValue="20"/></label><label>조건 묶음<select name="mode"><option value="all">AND</option><option value="any">OR</option></select></label></div><div className="form-row"><label>행동<select name="action"><option value="buy">BUY</option><option value="sell">SELL</option></select></label><label>주문 비율(bp)<input name="valueBps" type="number" min="1" max="10000" defaultValue="1000"/></label></div><button disabled={disabled}>DSL 생성</button></form>{disabled && <p>DRAFT 상태에서만 빌더를 편집할 수 있습니다.</p>}</section>;
}
