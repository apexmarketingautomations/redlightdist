import { Workspace } from "@/src/server/backoffice/workspace";
export default async function ClientAdmin({params}:{params:Promise<{creatorId:string}>}) {
  return <Workspace creatorId={(await params).creatorId} admin/>;
}
