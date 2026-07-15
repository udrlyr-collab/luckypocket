import StockDetail from"../../../components/StockDetail";export default async function Page({params}:{params:Promise<{symbol:string}>}){return <StockDetail symbol={(await params).symbol}/>}
