"use client";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import AppShell from "./AppShell";

const actions = [
  ["reselect_trend","추세 재선정"],["set_tier","안정성 티어 수동 보정"],["recalculate_fair_value","fair value 재계산"],
  ["rebuild_market_maker","시장조성 호가 재생성"],["start_distress","부실기업 심사 시작"],["end_distress","부실기업 심사 종료"],
  ["trigger_circuit_breaker","완화장치 수동 발동"],["inspect_price_path","비정상 가격 경로 검사"],
] as const;
const tiers=["BLUE_CHIP","GIANT","MEGA","LARGE","MID","SMALL","DELIST_RISK"];

export default function AdminDashboard(){
  const[status,setStatus]=useState<any>(),[users,setUsers]=useState<any[]>([]),[sus,setSus]=useState<any>(),[stocks,setStocks]=useState<any[]>([]),[toast,setToast]=useState("");
  const load=()=>Promise.all([api("/api/admin/status"),api<any[]>("/api/admin/users"),api("/api/admin/suspicious"),api<any[]>("/api/admin/stocks/stability")]).then(([a,b,c,d])=>{setStatus(a);setUsers(b);setSus(c);setStocks(d)}).catch(e=>setToast(e.message));
  useEffect(()=>{load()},[]);
  async function mutate(path:string,body:unknown,method="POST"){try{const out=await api(path,{method,body:JSON.stringify(body)});setToast(typeof out==="object"?JSON.stringify(out):"관리자 변경이 감사 로그에 기록되었습니다.");load()}catch(x:any){setToast(x.message)}}
  function asset(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);mutate(`/api/admin/users/${f.get("userId")}/assets`,{delta:f.get("delta"),reason:f.get("reason")})}
  function stock(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);mutate("/api/admin/stocks",{companyId:f.get("companyId"),symbol:f.get("symbol"),totalShares:f.get("totalShares"),freeFloatShares:f.get("freeFloatShares"),currentPrice:f.get("currentPrice"),tickSize:f.get("tickSize")})}
  function stabilityAction(stockId:string,action:string){if(!action)return;const reason=window.prompt("감사 로그에 남길 사유(3자 이상)");if(!reason||reason.trim().length<3)return;const body:any={action,reason};if(action==="set_tier"){const tier=window.prompt(`티어: ${tiers.join(", ")}`);if(!tier||!tiers.includes(tier as any))return;body.tier=tier}mutate(`/api/admin/stocks/${stockId}/stability-action`,body)}
  return <AppShell><div className="page-head"><div><span className="eyebrow">ADMIN ONLY</span><h1>관리자 대시보드</h1><p>모든 변경은 관리자 ID·대상·메타데이터와 함께 감사 로그에 기록됩니다.</p></div></div><div className="grid">
    <article className="panel metric"><span>열린 주문</span><strong>{status?.openOrders??"—"}</strong></article><article className="panel metric"><span>최근 5분 체결</span><strong>{status?.recentTrades??"—"}</strong></article><article className="panel metric"><span>실패 작업</span><strong>{status?.failedJobs??"—"}</strong></article><article className="panel metric"><span>WebSocket</span><strong>{status?.websocketConnections??"—"}</strong></article>
    <section className="panel half"><h2>자산 조정</h2><form className="form" onSubmit={asset}><label>사용자 ID<input name="userId" required/></label><div className="form-row"><label>증감액<input name="delta" required/></label><label>사유<input name="reason" minLength={3} required/></label></div><button>감사 기록 후 조정</button></form></section>
    <section className="panel half"><h2>종목 생성</h2><form className="form" onSubmit={stock}><label>기업 ID<input name="companyId" required/></label><div className="form-row"><label>Symbol<input name="symbol" required/></label><label>현재가<input name="currentPrice" required/></label></div><div className="form-row"><label>총주식<input name="totalShares" required/></label><label>유통주식<input name="freeFloatShares" required/></label></div><label>틱<input name="tickSize" defaultValue="1" required/></label><button>종목 생성</button></form></section>
    <section className="panel"><h2>종목 안정성 제어판</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>종목</th><th>현재/안정 시총</th><th>EMA 24h/7d</th><th>티어·추세</th><th>일일 변동/허용폭/목표변동성</th><th>적정가치·괴리</th><th>부실 위험</th><th>MM 깊이</th><th>완화장치</th><th>제어</th></tr></thead><tbody>{stocks.map(s=><tr key={s.id}><td>{s.symbol}<br/>{s.company_name}</td><td>{s.current_market_cap}<br/>{s.stability_market_cap}</td><td>{s.market_cap_ema_24h}<br/>{s.market_cap_ema_7d}</td><td>{s.stability_tier}<br/>{s.trend_regime} → {s.trend_ends_at}</td><td>{s.daily_change_bps}bp<br/>{s.daily_band?.downBps}~{s.daily_band?.upBps}bp<br/>σ {s.target_daily_volatility_bps}bp</td><td>{s.fundamental_fair_value}<br/>{s.fair_value_gap_bps}bp</td><td>{s.distress_score}<pre>{JSON.stringify(s.distress_components,null,1)}</pre></td><td>{s.market_maker_quote_depth}</td><td><pre>{JSON.stringify(s.recent_price_guards,null,1)}</pre></td><td><select defaultValue="" onChange={e=>{stabilityAction(s.id,e.target.value);e.currentTarget.value=""}}><option value="">작업 선택</option>{actions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></td></tr>)}</tbody></table></div></section>
    <section className="panel"><h2>사용자</h2><table><thead><tr><th>사용자</th><th>이메일</th><th>현금</th><th>상태</th><th>제어</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username}</td><td>{u.email}</td><td>{u.cash}</td><td>{u.is_active?"활성":"정지"}</td><td><button className="secondary" onClick={()=>mutate(`/api/admin/users/${u.id}/account`,{isActive:!u.is_active},"PATCH")}>{u.is_active?"정지":"복구"}</button></td></tr>)}</tbody></table></section>
    <section className="panel"><h2>의심 거래·보안 이벤트</h2><pre>{JSON.stringify(sus,null,2)}</pre></section>
  </div>{toast&&<div className="toast" onClick={()=>setToast("")}>{toast}</div>}</AppShell>
}
