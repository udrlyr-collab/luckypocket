"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import AppShell from "./AppShell";
import { api, token } from "../lib/api";

type Candle = { openedAt: string; close: string };

export default function StockDetail({ symbol }: { symbol: string }) {
  const [detail, setDetail] = useState<any>();
  const [book, setBook] = useState<any>();
  const [candles, setCandles] = useState<Candle[]>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [live, setLive] = useState(false);
  const load = useCallback(() => Promise.all([
    api(`/api/stocks/${symbol}`),
    api(`/api/stocks/${symbol}/order-book`),
    api<{ items: Candle[] }>(`/api/stocks/${symbol}/candles?interval=1m&limit=120`),
  ]).then(([nextDetail, nextBook, nextCandles]) => {
    setDetail(nextDetail);
    setBook(nextBook);
    setCandles(nextCandles.items);
    setError("");
  }).catch((reason) => setError(reason.message)), [symbol]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const accessToken = token();
    if (!accessToken || !detail?.id) return;
    const socket = io("/market", { auth: { token: accessToken }, reconnection: true, reconnectionAttempts: Infinity });
    const refresh = () => { socket.emit("stock.subscribe", detail.id); setLive(true); void load(); };
    socket.on("connect", refresh);
    socket.on("disconnect", () => setLive(false));
    socket.on("stock:trade", load);
    socket.on("order.stop_triggered", load);
    socket.on("auth:error", () => setLive(false));
    return () => { socket.emit("stock.unsubscribe", detail.id); socket.disconnect(); };
  }, [detail?.id, load]);

  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type"));
    const body: Record<string, string> = {
      symbol,
      idempotencyKey: crypto.randomUUID(),
      side: String(form.get("side")),
      type,
      quantity: String(form.get("quantity")),
      timeInForce: String(form.get("timeInForce")),
    };
    if (type === "limit") body.limitPrice = String(form.get("price"));
    try {
      await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
      setToast("주문이 접수되었습니다.");
      await load();
    } catch (reason: any) { setToast(reason.message); }
  }

  const points = useMemo(() => chartPoints(candles), [candles]);
  return <AppShell>
    {error ? <div className="state error">{error}</div> : !detail ? <div className="state">종목을 불러오는 중입니다.</div> : <>
      <div className="page-head"><div><span className="eyebrow">{detail.sector}</span><h1>{detail.symbol} · {detail.company_name ?? detail.name}</h1><p>{detail.description}</p></div><div><span className="pill">{live ? "실시간 연결" : "REST 상태"}</span><br/><strong style={{ fontSize: 32 }}>{detail.current_price}</strong><br/><span className={Number(detail.change_bps) >= 0 ? "up" : "down"}>{Number(detail.change_bps) >= 0 ? "+" : ""}{(Number(detail.change_bps ?? 0) / 100).toFixed(2)}%</span></div></div>
      <div className="grid">
        <article className="panel"><h2>가격 특성</h2><div className="actions"><span className="pill">기업 규모: {tierLabel(detail.stability_tier)}</span><span className="pill">가격 특성: {priceCharacter(detail.stability_tier)}</span><span className="pill">현재 추세: {trendLabel(detail.trend_regime)}</span></div>{detail.listing_status==="distress_review"&&<div className="state"><strong>부실기업 심사</strong><br/>재무 위험이 높아져 변동성이 커졌어요. 실적과 기업 뉴스를 확인해 주세요.</div>}</article>
        <article className="panel half"><h2>실제 체결 차트</h2>{points ? <svg className="chart" viewBox="0 0 600 180" role="img" aria-label="최근 1분봉 종가"><polyline fill="none" stroke="currentColor" strokeWidth="3" points={points}/></svg> : <div className="state">체결 데이터가 아직 없습니다.</div>}<div className="actions"><span className="pill">기준가 {detail.reference_price}</span><span className="pill">상장 상태 {detail.listing_status ?? "normal"}</span></div></article>
        <article className="panel half"><h2>주문</h2><form className="form" onSubmit={order}><div className="form-row"><label>방향<select name="side"><option value="buy">매수</option><option value="sell">매도</option></select></label><label>유형<select name="type"><option value="limit">지정가</option><option value="market">시장가</option></select></label></div><div className="form-row"><label>수량<input name="quantity" type="number" min="1" required/></label><label>지정가<input name="price" type="number" min="1"/></label></div><label>유효 조건<select name="timeInForce"><option value="GTC">GTC</option><option value="IOC">IOC</option></select></label><button>주문 제출</button></form></article>
        <article className="panel"><h2>주주·지배권</h2><div className="actions"><span className="pill">유통주식 {detail.free_float_shares}</span><span className="pill">자사주 {detail.treasury_shares}</span><span className="pill">경영권 {detail.controlled_by_user_id ? "지배주주 있음" : "분산"}</span></div>{detail.top_shareholders?.length ? <table><thead><tr><th>주요 주주</th><th>수량</th><th>지분율</th><th>의결권</th></tr></thead><tbody>{detail.top_shareholders.map((holder: any) => <tr key={holder.userId}><td>{holder.nickname}</td><td>{holder.quantity}</td><td>{(Number(holder.ownershipBps) / 100).toFixed(2)}%</td><td>{holder.quantity}</td></tr>)}</tbody></table> : <div className="state">공시 기준 5% 이상 주요 주주가 없습니다.</div>}</article>
        <article className="panel half"><h2>매도 호가</h2><table><tbody>{book?.asks?.map((row: any) => <tr key={row.price}><td className="down">{row.price}</td><td>{row.quantity}</td><td>{row.orderCount}</td></tr>)}</tbody></table></article>
        <article className="panel half"><h2>매수 호가</h2><table><tbody>{book?.bids?.map((row: any) => <tr key={row.price}><td className="up">{row.price}</td><td>{row.quantity}</td><td>{row.orderCount}</td></tr>)}</tbody></table></article>
      </div>
    </>}
    {toast && <div className="toast" onClick={() => setToast("")}>{toast}</div>}
  </AppShell>;
}

function chartPoints(candles: Candle[]): string {
  if (candles.length < 2) return "";
  const values = candles.map((item) => Number(item.close));
  const low = Math.min(...values), high = Math.max(...values), range = Math.max(1, high - low);
  return values.map((value, index) => `${index * 600 / (values.length - 1)},${170 - (value - low) * 160 / range}`).join(" ");
}

function tierLabel(tier:string){return({BLUE_CHIP:"우량 대형주",GIANT:"초대형주",MEGA:"대형주",LARGE:"중대형주",MID:"중형주",SMALL:"소형주",DELIST_RISK:"상장폐지 위험주"} as Record<string,string>)[tier]??"분류 중"}
function priceCharacter(tier:string){if(tier==="BLUE_CHIP")return"완만한 우상향 · 낮은 변동성";if(tier==="GIANT"||tier==="MEGA")return"완만한 우상향 · 중간 변동성";if(tier==="LARGE"||tier==="MID")return"완만한 우상향 · 높은 변동성";return"큰 등락 가능"}
function trendLabel(regime:string){return regime==="BULL"?"상승 추세":regime==="BEAR"?"조정 구간":"횡보 구간"}
