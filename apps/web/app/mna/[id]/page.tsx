import { MnaDetail } from "../../../components/Mna";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <MnaDetail id={(await params).id}/>; }
