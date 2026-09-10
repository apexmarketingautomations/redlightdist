import { PublicCreatorSite } from "@/src/server/public/creator-site";

export default async function CreatorSitePage({
  params,
  searchParams,
}:{
  params:Promise<{hostname:string;path?:string[]}>;
  searchParams:Promise<{token?:string}>;
}){
  const {hostname,path=[]}=await params;
  const {token}=await searchParams;
  return <PublicCreatorSite hostname={hostname} path={path} token={token}/>;
}
