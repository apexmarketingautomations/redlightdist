import { CreatorConsole } from "@/src/server/creator/console";
export default async function CreatorSectionPage({params}:{params:Promise<{creatorId:string;section:string}>}) {
  const {creatorId,section}=await params;
  return <CreatorConsole creatorId={creatorId} section={section}/>;
}
