export type MarketSignal={changeBps:number;source:string;observedAt:Date};
export type SectorSignal={sector:string;changeBps:number;source:string;observedAt:Date};
export type Candle={openedAt:Date;open:bigint;high:bigint;low:bigint;close:bigint;volume:bigint};
export type MacroIndicator={key:string;value:string;unit:string;source:string;observedAt:Date};
export interface ExternalMarketDataProvider{getMarketIndexSignal():Promise<MarketSignal>;getSectorSignals():Promise<SectorSignal[]>;getHistoricalCandles(symbol:string):Promise<Candle[]>;getMacroIndicators():Promise<MacroIndicator[]>;}

export class MockMarketDataProvider implements ExternalMarketDataProvider{
  async getMarketIndexSignal(){return{changeBps:0,source:"mock",observedAt:new Date(0)}}async getSectorSignals(){return[]}async getHistoricalCandles(_symbol:string){return[]}async getMacroIndicators(){return[]}
}

type FetchLike=(input:string,init?:RequestInit)=>Promise<Response>;
export class StooqFredMarketDataProvider implements ExternalMarketDataProvider{
  constructor(private readonly options:{fredApiKey?:string;marketSymbol?:string;sectorSymbols?:Record<string,string>;fetcher?:FetchLike}={}){}
  async getMarketIndexSignal(){const candles=await this.getHistoricalCandles(this.options.marketSymbol??"^spx");if(candles.length<2)throw new Error("EXTERNAL_MARKET_HISTORY_INSUFFICIENT");const previous=candles.at(-2)!,current=candles.at(-1)!;return{changeBps:Number((current.close-previous.close)*10_000n/previous.close),source:"stooq",observedAt:current.openedAt}}
  async getSectorSignals(){const entries=Object.entries(this.options.sectorSymbols??{});return Promise.all(entries.map(async([sector,symbol])=>{const candles=await this.getHistoricalCandles(symbol);if(candles.length<2)throw new Error("EXTERNAL_SECTOR_HISTORY_INSUFFICIENT");const p=candles.at(-2)!,c=candles.at(-1)!;return{sector,changeBps:Number((c.close-p.close)*10_000n/p.close),source:"stooq",observedAt:c.openedAt}}))}
  async getHistoricalCandles(symbol:string){if(!/^[A-Za-z0-9.^_-]{1,20}$/.test(symbol))throw new Error("EXTERNAL_SYMBOL_INVALID");const response=await this.fetcher()(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`,{headers:{Accept:"text/csv"},signal:AbortSignal.timeout(5_000)});if(!response.ok)throw new Error(`STOOQ_HTTP_${response.status}`);const text=await response.text(),lines=text.trim().split(/\r?\n/);if(lines[0]!=="Date,Open,High,Low,Close,Volume")throw new Error("STOOQ_FORMAT_INVALID");return lines.slice(1).map(parseStooq).filter((v):v is Candle=>v!==null)}
  async getMacroIndicators(){if(!this.options.fredApiKey)return[];const series=["GDP","CPIAUCSL","UNRATE"];return Promise.all(series.map(async key=>{const url=`https://api.stlouisfed.org/fred/series/observations?series_id=${key}&api_key=${encodeURIComponent(this.options.fredApiKey!)}&file_type=json&sort_order=desc&limit=1`;const response=await this.fetcher()(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(5_000)});if(!response.ok)throw new Error(`FRED_HTTP_${response.status}`);const body=await response.json() as {observations?:Array<{date:string;value:string}>};const point=body.observations?.[0];if(!point)throw new Error("FRED_FORMAT_INVALID");return{key,value:point.value,unit:"source-defined",source:"fred",observedAt:new Date(`${point.date}T00:00:00Z`)}}))}
  private fetcher(){return this.options.fetcher??fetch}
}

export class ResilientMarketDataProvider implements ExternalMarketDataProvider{
  constructor(private readonly primary:ExternalMarketDataProvider,private readonly fallback:ExternalMarketDataProvider=new MockMarketDataProvider()){}
  getMarketIndexSignal(){return safe(()=>this.primary.getMarketIndexSignal(),()=>this.fallback.getMarketIndexSignal())}getSectorSignals(){return safe(()=>this.primary.getSectorSignals(),()=>this.fallback.getSectorSignals())}getHistoricalCandles(symbol:string){return safe(()=>this.primary.getHistoricalCandles(symbol),()=>this.fallback.getHistoricalCandles(symbol))}getMacroIndicators(){return safe(()=>this.primary.getMacroIndicators(),()=>this.fallback.getMacroIndicators())}
}
function parseStooq(line:string):Candle|null{const[d,o,h,l,c,v]=line.split(",");if(!d||!o||!h||!l||!c)return null;const scale=100n;const price=(x:string)=>BigInt(Math.round(Number(x)*Number(scale)));const candle={openedAt:new Date(`${d}T00:00:00Z`),open:price(o),high:price(h),low:price(l),close:price(c),volume:BigInt(v&&/^\d+$/.test(v)?v:"0")};return Number.isNaN(candle.openedAt.getTime())||candle.low<=0n?null:candle}
async function safe<T>(primary:()=>Promise<T>,fallback:()=>Promise<T>){try{return await primary()}catch{return fallback()}}
