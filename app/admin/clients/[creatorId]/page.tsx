import { Workspace } from "@/src/server/backoffice/workspace";
export default async function ClientAdmin({params}:{params:Promise<{creatorId:string}>}) {
  const {creatorId}=await params;
  return <><div className="office-support-launch"><a className="office-button" href={`/admin/clients/${creatorId}/support`}>Start audited support session</a><a className="office-button quiet" href={`/admin/clients/${creatorId}/operations`}>Open operations</a></div><Workspace creatorId={creatorId} admin/></>;
}
