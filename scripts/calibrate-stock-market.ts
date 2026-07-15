import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DAILY_BASE_DRIFT, NORMAL_DAILY_MOVE_BANDS, NORMAL_TREND_PROBABILITIES, TARGET_DAILY_VOLATILITY, type StabilityTier } from "../packages/domain/src/market-stability.js";

const paths = Number(process.env.MONTE_CARLO_PATHS ?? "100000");
if (!Number.isInteger(paths) || paths < 100_000) throw new Error("MONTE_CARLO_PATHS_MUST_BE_AT_LEAST_100000");
const seed = Number(process.env.MONTE_CARLO_SEED ?? "20260713");
const rng = mulberry32(seed);
const scenarios: Array<{ name:string;tier:StabilityTier;initialCap:number;distress:boolean }> = [
  {name:"BLUE_CHIP",tier:"BLUE_CHIP",initialCap:2e12,distress:false},{name:"GIANT",tier:"GIANT",initialCap:1.5e12,distress:false},
  {name:"MEGA",tier:"MEGA",initialCap:7e11,distress:false},{name:"LARGE",tier:"LARGE",initialCap:2.5e11,distress:false},
  {name:"MID",tier:"MID",initialCap:8e10,distress:false},{name:"SMALL",tier:"SMALL",initialCap:1.5e10,distress:false},
  {name:"DELIST_RISK",tier:"DELIST_RISK",initialCap:4e9,distress:false},{name:"DISTRESS_GIANT",tier:"GIANT",initialCap:1.5e12,distress:true},
];
const results = scenarios.map(simulate);
const generated = new Date().toISOString();
const rows = results.flatMap(r=>[2,7,30].map(days=>{const m=r.metrics[days];return `| ${r.name} | ${days} | ${pct(m.mean)} | ${pct(m.median)} | ${pct(m.p05)} | ${pct(m.p95)} | ${pct(m.meanMaxDrawdown)} | ${pct(m.drop50)} | ${pct(m.drop80)} | ${pct(m.delistReview)} | ${pct(r.regimes.bull)} / ${pct(r.regimes.sideways)} / ${pct(r.regimes.bear)} |`;})).join("\n");
const giant=results.find(r=>r.name==="GIANT")!, blue=results.find(r=>r.name==="BLUE_CHIP")!, distress=results.find(r=>r.name==="DISTRESS_GIANT")!;
const checks=[
  ["GIANT 30일 중앙 수익률 > 0",giant.metrics[30].median>0],["GIANT 2일 50% 하락 확률 = 0",giant.metrics[2].drop50===0],
  ["GIANT 30일 80% 하락 확률 ≤ 0.01%",giant.metrics[30].drop80<=0.0001],["BLUE_CHIP 30일 평균 최대낙폭 < GIANT",blue.metrics[30].meanMaxDrawdown<giant.metrics[30].meanMaxDrawdown],
  ["DISTRESS_GIANT 하방 위험 > GIANT",distress.metrics[30].p05<giant.metrics[30].p05],["DISTRESS_GIANT 2일 80% 하락 확률 = 0",distress.metrics[2].drop80===0],
] as const;
const report=`# MARKET CALIBRATION REPORT

생성: ${generated}  
시드: ${seed}  
경로 수: 시나리오당 ${paths.toLocaleString()}개  
기간: 2일·7일·30일

## 모델

- 각 거래일마다 티어별 bull/sideways/bear 확률로 국면 선택.
- 티어별 목표 일일 변동성, 기본 drift, 일일 상·하한 적용.
- DISTRESS_GIANT만 drift -0.20%p/일, 변동성 1.5배, 재무 기반 심사 확률 2%/일 적용.
- 정상 종목 재무 심사 확률은 0.001%/일. DELIST_RISK는 시총 기준으로 즉시 심사 대상.
- 본 결과는 설정 모델의 결정적 Monte Carlo 검증. 실제 운영 수익률 예측 아님.

## 결과

| 시나리오 | 일수 | 평균 | 중앙 | 5% | 95% | 평균 최대낙폭 | 50%↓ 확률 | 80%↓ 확률 | 심사 진입 확률 | 국면 비율 B/S/B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

## 목표 판정

${checks.map(([label,pass])=>`- ${pass?"PASS":"FAIL"}: ${label}`).join("\n")}
`;
const output=fileURLToPath(new URL("../docs/MARKET_CALIBRATION_REPORT.md",import.meta.url));writeFileSync(output,report,"utf8");
process.stdout.write(report);if(checks.some(([,pass])=>!pass))process.exitCode=1;

function simulate(s:{name:string;tier:StabilityTier;initialCap:number;distress:boolean}){
  const snapshots:Record<number,number[]>={2:[],7:[],30:[]},drawdowns:Record<number,number[]>={2:[],7:[],30:[]},reviews:Record<number,number>={2:0,7:0,30:0};
  const regimeCounts={bull:0,sideways:0,bear:0};
  for(let path=0;path<paths;path++){let price=1,peak=1,maxDd=0,review=false;for(let day=1;day<=30;day++){
    const p=NORMAL_TREND_PROBABILITIES[s.tier],u=rng();const regime=u<p.bull?"bull":u<p.bull+p.sideways?"sideways":"bear";regimeCounts[regime]++;
    const regimeDrift=regime==="bull"?0.001:regime==="bear"?-0.0015:0;const sigma=TARGET_DAILY_VOLATILITY[s.tier]*(s.distress?1.5:1);
    let daily=DAILY_BASE_DRIFT[s.tier]+regimeDrift+(s.distress?-0.002:0)+normal(rng)*sigma;
    const band=NORMAL_DAILY_MOVE_BANDS[s.tier];daily=Math.max(s.distress?Math.max(-0.45,band.maxDown*1.35):band.maxDown,Math.min(s.distress?Math.min(0.60,band.maxUp*1.2):band.maxUp,daily));
    price*=1+daily;peak=Math.max(peak,price);maxDd=Math.max(maxDd,1-price/peak);
    if(!review&&(s.initialCap*price<5e9||rng()<(s.distress?0.02:0.00001)))review=true;
    if(day===2||day===7||day===30){snapshots[day].push(price-1);drawdowns[day].push(maxDd);if(review)reviews[day]++;}
  }}
  const metrics:Record<number,ReturnType<typeof summarize>>={};for(const d of [2,7,30])metrics[d]=summarize(snapshots[d],drawdowns[d],reviews[d]/paths);
  const total=regimeCounts.bull+regimeCounts.sideways+regimeCounts.bear;return{name:s.name,metrics,regimes:{bull:regimeCounts.bull/total,sideways:regimeCounts.sideways/total,bear:regimeCounts.bear/total}};
}
function summarize(values:number[],dds:number[],delistReview:number){values.sort((a,b)=>a-b);return{mean:values.reduce((a,b)=>a+b,0)/values.length,median:q(values,.5),p05:q(values,.05),p95:q(values,.95),meanMaxDrawdown:dds.reduce((a,b)=>a+b,0)/dds.length,drop50:values.filter(v=>v<=-.5).length/values.length,drop80:values.filter(v=>v<=-.8).length/values.length,delistReview};}
function q(a:number[],p:number){return a[Math.min(a.length-1,Math.floor((a.length-1)*p))]!}function pct(v:number){return `${(v*100).toFixed(4)}%`}
function normal(r:()=>number){const u=Math.max(Number.EPSILON,r()),v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function mulberry32(a:number){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
