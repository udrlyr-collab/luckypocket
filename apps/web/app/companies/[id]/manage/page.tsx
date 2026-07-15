import CompanyManage from"../../../../components/CompanyManage";export default async function Page({params}:{params:Promise<{id:string}>}){return <CompanyManage id={(await params).id}/>}
