import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";
import { canFanAccessAsset } from "@/src/modules/content/access";
import { ensureStorageProvidersRegistered } from "@/src/modules/storage/register";
import { getStorageProvider } from "@/src/modules/storage/provider";

export async function GET(request:Request,{params}:{params:Promise<{assetId:string}>}){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const {assetId}=await params;if(!z.string().uuid().safeParse(assetId).success)return new NextResponse("Not found",{status:404});
  const fan=await getCurrentFan();
  try{
    const asset=await withCreator(tenant.creatorId,async client=>{
      const allowed=await canFanAccessAsset(client,{creatorId:tenant.creatorId,assetId,fanId:fan?.creatorId===tenant.creatorId?fan.id:null});
      if(!allowed)return null;
      return (await client.query<{storage_provider:string;object_key:string}>("SELECT storage_provider,object_key FROM media_assets WHERE creator_id=$1 AND id=$2 AND status='ready' AND deleted_at IS NULL",[tenant.creatorId,assetId])).rows[0]??null;
    });
    if(!asset)return new NextResponse("Not found",{status:404});
    ensureStorageProvidersRegistered();
    const signed=await getStorageProvider(asset.storage_provider).createDownload({creatorId:tenant.creatorId,objectKey:asset.object_key,expiresInSeconds:120});
    return NextResponse.redirect(signed.url,307);
  }catch(error){
    console.error("Protected media delivery failed",{creatorId:tenant.creatorId,assetId,message:error instanceof Error?error.message:"unknown"});
    return new NextResponse("Media unavailable",{status:503});
  }
}
