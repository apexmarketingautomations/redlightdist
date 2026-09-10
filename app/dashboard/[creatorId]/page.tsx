import { Workspace } from "@/src/server/backoffice/workspace";
export default async function ClientWorkspace({params}:{params:Promise<{creatorId:string}>}) {
  return <Workspace creatorId={(await params).creatorId}/>;
}
