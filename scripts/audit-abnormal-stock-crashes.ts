import { createDatabase } from "../packages/database/src/index.js";

const apply=process.argv.includes("--apply");
const adminId=process.argv.find(a=>a.startsWith("--admin-id="))?.slice(11)??null;
if(apply&&!adminId)throw new Error("--apply requires --admin-id=<uuid>");
const url=process.env.DATABASE_URL;if(!url)throw new Error("DATABASE_URL is required");
const{pool}=createDatabase(url);
try{
  const result=await pool.query<any>(`SELECT s.id,s.symbol,s.current_price,s.total_shares,s.stability_tier,s.stability_market_cap,s.listing_status,s.fundamental_fair_value,
    h24.price price_24h,h48.price price_48h,h7.max_cap max_cap_7d,h7.median_price median_price_7d,last_candle.close last_candle_price,
    COALESCE(dupes.count,0)::int duplicate_ticks
    FROM stocks s
    LEFT JOIN LATERAL(SELECT close price FROM candles WHERE stock_id=s.id AND opened_at<=now()-interval '24 hours' ORDER BY opened_at DESC LIMIT 1)h24 ON true
    LEFT JOIN LATERAL(SELECT close price FROM candles WHERE stock_id=s.id AND opened_at<=now()-interval '48 hours' ORDER BY opened_at DESC LIMIT 1)h48 ON true
    LEFT JOIN LATERAL(SELECT max(high* s.total_shares)::bigint max_cap,percentile_cont(.5) WITHIN GROUP(ORDER BY close)::bigint median_price FROM candles WHERE stock_id=s.id AND opened_at>=now()-interval '7 days')h7 ON true
    LEFT JOIN LATERAL(SELECT close FROM candles WHERE stock_id=s.id ORDER BY opened_at DESC LIMIT 1)last_candle ON true
    LEFT JOIN LATERAL(SELECT count(*) count FROM(SELECT date_trunc('second',created_at),count(DISTINCT price) FROM trades WHERE stock_id=s.id AND created_at>=now()-interval '7 days' GROUP BY 1 HAVING count(DISTINCT price)>1)x)dupes ON true
    WHERE s.asset_type='common'`);
  const findings=result.rows.map(row=>inspect(row)).filter(x=>x.reasons.length>0);
  process.stdout.write(JSON.stringify({mode:apply?"apply":"dry-run",count:findings.length,findings},null,2)+"\n");
  if(apply)for(const finding of findings){
    if(!finding.repairPrice||BigInt(finding.repairPrice)===BigInt(finding.currentPrice))continue;
    const c=await pool.connect();try{await c.query("BEGIN");const locked=await c.query<any>("SELECT current_price FROM stocks WHERE id=$1 FOR UPDATE",[finding.stockId]);if(!locked.rows[0]){await c.query("ROLLBACK");continue;}
      const before=locked.rows[0].current_price;await c.query("UPDATE stocks SET current_price=$2,reference_price=$2,daily_anchor_price=$2,daily_anchor_at=now(),updated_at=now() WHERE id=$1",[finding.stockId,finding.repairPrice]);
      await c.query("INSERT INTO price_guard_events(stock_id,event_type,triggered_by,reference_price,observed_price,protected_price,metadata) VALUES($1,'abnormal_path_repair','admin',$2,$3,$4,$5::jsonb)",[finding.stockId,before,before,finding.repairPrice,JSON.stringify({reasons:finding.reasons,candidates:finding.candidates,adminId})]);
      await c.query("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata) VALUES($1,'admin.abnormal_price_repair','stock',$2,$3::jsonb)",[adminId,finding.stockId,JSON.stringify({before,after:finding.repairPrice,reasons:finding.reasons,candidates:finding.candidates})]);await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }
}finally{await pool.end()}

function inspect(r:any){const current=BigInt(r.current_price),shares=BigInt(r.total_shares),cap=current*shares,reasons:string[]=[];
  const decline=(old:any)=>old&&BigInt(old)>0n?Number(current-BigInt(old))/Number(BigInt(old)):0;
  if(decline(r.price_48h)<=-.8)reasons.push("48h_decline_80_percent");if(decline(r.price_24h)<=-.6)reasons.push("24h_decline_60_percent");
  if(r.stability_tier==="GIANT"&&cap<500_000_000_000n)reasons.push("giant_dropped_two_or_more_tiers");
  if(cap>=5_000_000_000n&&r.listing_status==="delisting_review")reasons.push("delisting_review_above_5b");
  if(BigInt(r.max_cap_7d??0)>=1_000_000_000_000n&&cap<10_000_000_000n)reasons.push("one_trillion_to_under_10b_within_7d");
  if(r.last_candle_price&&BigInt(r.last_candle_price)!==current)reasons.push("latest_history_mismatch");if(r.duplicate_ticks>0)reasons.push("multiple_prices_same_second");
  const candidates=[r.price_48h,r.median_price_7d,r.fundamental_fair_value].filter((v:any)=>v&&BigInt(v)>0n).map(String).sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  const repairPrice=candidates.length?candidates[Math.floor(candidates.length/2)]!:null;
  return{stockId:r.id,symbol:r.symbol,currentPrice:r.current_price,currentMarketCap:cap.toString(),reasons,candidates,repairPrice};}
