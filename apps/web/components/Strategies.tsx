"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "./AppShell";
import VisualStrategyBuilder from "./VisualStrategyBuilder";
import { api } from "../lib/api";

const definition = { version: 1, when: { mode: "all", conditions: [{ left: { kind: "indicator", indicator: "ema", period: 5 }, operator: "gt", right: { kind: "indicator", indicator: "ema", period: 20 } }] }, then: { type: "buy", sizing: "percent_available_cash", valueBps: 1000 } };
const safety = { initialCash: "100000000", feeBps: 10, slippageBps: 20, maxOrderAmount: "10000000", maxHoldingBps: 3000, dailyMaxLossBps: 1000, cooldownBars: 1, stopLossBps: 500, takeProfitBps: 1000 };

export function StrategyList() {
  const [items, setItems] = useState<any[]>();
  const [stocks, setStocks] = useState<any[]>([]);
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<any[]>("/api/strategies").then(setItems).catch((e) => setToast(e.message)), []);
  useEffect(() => { void load(); void api<any>("/api/stocks?pageSize=100").then((value) => setStocks(value.items ?? value)).catch((e) => setToast(e.message)); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/strategies", { method: "POST", body: JSON.stringify({ name: form.get("name"), stockId: form.get("stockId"), interval: form.get("interval"), definition, safety }) }); setToast("전략을 생성했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  return <AppShell><div className="page-head"><div><span className="eyebrow">AUTOMATION</span><h1>자동매매 전략</h1><p>제한형 조건 DSL과 안전 한도 안에서만 실행됩니다.</p></div></div><div className="grid"><section className="panel third"><h2>새 전략</h2><form className="form" onSubmit={create}><label>이름<input name="name" required/></label><label>종목<select name="stockId" required>{stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.symbol}</option>)}</select></label><label>봉<select name="interval"><option>1m</option><option>5m</option><option>15m</option><option>1h</option><option>1d</option></select></label><button>초안 생성</button></form></section><section className="panel" style={{ gridColumn: "span 8" }}><h2>내 전략</h2>{!items ? <div className="state">불러오는 중입니다.</div> : items.length === 0 ? <div className="state">전략이 없습니다.</div> : <table><thead><tr><th>이름</th><th>종목</th><th>상태</th><th>봉</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><a href={`/strategies/${item.id}`}>{item.name}</a></td><td>{item.symbol}</td><td><span className="pill">{item.status}</span></td><td>{item.interval}</td></tr>)}</tbody></table>}</section></div>{toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}</AppShell>;
}

export function StrategyDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<any>();
  const [definitionText, setDefinitionText] = useState("");
  const [safetyText, setSafetyText] = useState("");
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<any>(`/api/strategies/${id}`).then((value) => { setDetail(value); setDefinitionText(JSON.stringify(value.definition, null, 2)); setSafetyText(JSON.stringify(value.safety, null, 2)); }).catch((e) => setToast(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  async function action(path: string, body: unknown) { try { await api(`/api/strategies/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }); setToast("처리되었습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  async function save() { try { await api(`/api/strategies/${id}`, { method: "PATCH", body: JSON.stringify({ definition: JSON.parse(definitionText), safety: JSON.parse(safetyText) }) }); setToast("DSL과 안전 설정을 저장했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  return <AppShell>{!detail ? <div className="state">전략을 불러오는 중입니다.</div> : <><div className="page-head"><div><span className="eyebrow">{detail.status}</span><h1>{detail.name}</h1><p>현재 봉에서 신호를 평가하고 다음 봉 또는 실제 주문장에서 실행합니다.</p></div><div className="actions"><button onClick={() => action("backtests", {})}>백테스트</button><button className="secondary" onClick={() => action("status", { status: "PAPER" })}>PAPER</button><button className="secondary" onClick={() => action("status", { status: "LIVE_VIRTUAL", confirmLiveVirtual: true })}>LIVE 확인·실행</button><button className="secondary" onClick={() => action("status", { status: "PAUSED" })}>정지</button></div></div><VisualStrategyBuilder onBuild={(value) => setDefinitionText(JSON.stringify(value, null, 2))} disabled={detail.status !== "DRAFT"}/><div className="grid"><article className="panel half"><h2>전략 DSL</h2><textarea rows={18} value={definitionText} onChange={(event) => setDefinitionText(event.target.value)} disabled={detail.status !== "DRAFT"}/></article><article className="panel half"><h2>안전 설정</h2><textarea rows={18} value={safetyText} onChange={(event) => setSafetyText(event.target.value)} disabled={detail.status !== "DRAFT"}/>{detail.status === "DRAFT" && <button onClick={save}>편집 저장</button>}</article><article className="panel"><h2>백테스트</h2><pre>{JSON.stringify(detail.backtests?.[0]?.result ?? "실행 기록 없음", null, 2)}</pre></article><article className="panel"><h2>실행 감사 기록</h2><pre>{JSON.stringify(detail.executions ?? [], null, 2)}</pre></article></div></>}{toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}</AppShell>;
}
