import { redirect } from "next/navigation";
import { PublicCreatorSite } from "@/src/server/public/creator-site";

export default async function CreatorSitePage({params,searchParams}:{params:Promise<{hostname:string;path?:string[]}>;searchParams:Promise<{token?:string;ref?:string}>;}){
  const {hostname,path=[]}=await params;const {token,ref}=await searchParams;
  if(ref){const returnTo=`/${path.join("/")}`;redirect(`/api/referrals/capture?code=${encodeURIComponent(ref)}&returnTo=${encodeURIComponent(returnTo||"/")}`);}
  return <PublicCreatorSite hostname={hostname} path={path} token={token}/>;
}
