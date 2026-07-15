"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "./AppShell";
import { api } from "../lib/api";

export default function Leverage() {
  const [items, setItems] = useState<any[]>();
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<any[]>("/api/leverage/positions").then(setItems).catch((e) => setToast(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function open(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/leverage/positions", { method: "POST", body: JSON.stringify({ symbol: form.get("symbol"), side: form.get("side"), leverage: Number(form.get("leverage")), margin: form.get("margin") }) }); setToast("포지션을 개설했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  async function close(id: string) { try { await api(`/api/leverage/positions/${id}/close`, { method: "POST" }); setToast("실제 호가장에 청산 주문을 제출했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  return <AppShell><div className="page-head"><div><span className="eyebrow">DERIVATIVES</span><h1>레버리지·공매도</h1><p>증거금, 실제 손익, 대차료, 청산가를 확인합니다.</p></div></div><div className="grid"><section className="panel third"><h2>포지션 개설</h2><form className="form" onSubmit={open}><label>종목 Symbol<input name="symbol" required/></label><label>방향<select name="side"><option value="long">Long</option><option value="short">Short</option></select></label><label>배율<select name="leverage">{[1,2,3,5,10,20].map((x) => <option key={x} value={x}>{x}x</option>)}</select></label><label>증거금<input name="margin" type="number" min="1" required/></label><button>위험 확인·개설</button></form></section><section className="panel" style={{ gridColumn: "span 8" }}><h2>내 포지션</h2>{!items ? <div className="state">불러오는 중입니다.</div> : items.length === 0 ? <div className="state">포지션이 없습니다.</div> : <table><thead><tr><th>종목</th><th>방향</th><th>배율</th><th>수량</th><th>진입가</th><th>현재가</th><th>손익</th><th>청산가</th><th>상태</th><th>제어</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.symbol}</td><td>{item.side}</td><td>{item.leverage}x</td><td>{item.quantity}</td><td>{item.entryPrice}</td><td>{item.currentPrice}</td><td className={BigInt(item.estimate?.pnl ?? 0) >= 0n ? "up" : "down"}>{item.estimate?.pnl}</td><td>{item.liquidationPrice}</td><td>{item.status}</td><td>{item.status === "open" && <button className="secondary" onClick={() => close(item.id)}>청산</button>}</td></tr>)}</tbody></table>}</section></div>{toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}</AppShell>;
}
