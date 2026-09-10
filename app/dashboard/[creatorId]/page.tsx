import { CreatorConsole } from "@/src/server/creator/console";
export default async function ClientWorkspace({params}:{params:Promise<{creatorId:string}>}) {
  return <CreatorConsole creatorId={(await params).creatorId} section="overview"/>;
}
