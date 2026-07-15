import{StrategyDetail}from"../../../components/Strategies";export default async function Page({params}:{params:Promise<{id:string}>}){return <StrategyDetail id={(await params).id}/>}
