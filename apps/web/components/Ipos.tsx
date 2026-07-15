"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "./AppShell";
import { api } from "../lib/api";

export default function Ipos() {
  const [items, setItems] = useState<any[]>();
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<any[]>("/api/ipos").then(setItems).catch((e) => setToast(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function subscribe(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api("/api/ipos/subscribe", { method: "POST", body: JSON.stringify({ campaignId: form.get("campaignId"), quantity: form.get("quantity") }) }); setToast("IPO 청약 예약을 갱신했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  return <AppShell><div className="page-head"><div><span className="eyebrow">PRIMARY MARKET</span><h1>IPO</h1><p>상장 예고, 청약, 배정, 상장 일정을 확인합니다.</p></div></div><div className="grid"><section className="panel third"><h2>청약</h2><form className="form" onSubmit={subscribe}><label>캠페인<select name="campaignId" required>{items?.filter((x) => x.status === "subscription").map((x) => <option key={x.id} value={x.id}>{x.symbol} · {x.offer_price}</option>)}</select></label><label>수량<input name="quantity" type="number" min="1" required/></label><button>현금 예약·청약</button></form></section><section className="panel" style={{ gridColumn: "span 8" }}><h2>공모 일정</h2>{!items ? <div className="state">불러오는 중입니다.</div> : items.length === 0 ? <div className="state">진행 중인 IPO가 없습니다.</div> : <table><thead><tr><th>Symbol</th><th>기업</th><th>상태</th><th>공모가</th><th>공모주</th><th>청약량</th><th>상장일</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.symbol}</td><td>{item.company_name}</td><td>{item.status}</td><td>{item.offer_price}</td><td>{item.offered_shares}</td><td>{item.subscribed_quantity}</td><td>{new Date(item.listing_at).toLocaleString("ko-KR")}</td></tr>)}</tbody></table>}</section></div>{toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}</AppShell>;
}
