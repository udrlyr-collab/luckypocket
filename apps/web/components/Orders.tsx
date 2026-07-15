"use client";
import { useCallback, useEffect, useState } from "react";
import AppShell from "./AppShell";
import { api } from "../lib/api";

export default function Orders() {
  const [items, setItems] = useState<any[]>();
  const [toast, setToast] = useState("");
  const load = useCallback(() => api<any[]>("/api/orders").then(setItems).catch((e) => setToast(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function cancel(id: string) { try { await api(`/api/orders/${id}/cancel`, { method: "POST" }); setToast("주문을 취소했습니다."); await load(); } catch (e: any) { setToast(e.message); } }
  return <AppShell><div className="page-head"><div><span className="eyebrow">ORDER HISTORY</span><h1>주문과 체결</h1><p>주문 상태를 확인하고 열린 주문의 예약 자산을 반환합니다.</p></div></div><section className="panel">{!items ? <div className="state">불러오는 중입니다.</div> : items.length === 0 ? <div className="state">주문이 없습니다.</div> : <table><thead><tr><th>종목</th><th>방향</th><th>유형</th><th>가격</th><th>수량</th><th>체결</th><th>상태</th><th>제어</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.symbol ?? item.stockId}</td><td>{item.side}</td><td>{item.type}</td><td>{item.limitPrice ?? "시장가"}</td><td>{item.quantity}</td><td>{item.filledQuantity}</td><td><span className="pill">{item.status}</span></td><td>{["pending", "open", "partially_filled"].includes(item.status) && <button className="secondary" onClick={() => cancel(item.id)}>취소</button>}</td></tr>)}</tbody></table>}</section>{toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}</AppShell>;
}
