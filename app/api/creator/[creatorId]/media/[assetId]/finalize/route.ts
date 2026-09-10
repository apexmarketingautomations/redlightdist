import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { ensureStorageProvidersRegistered } from "@/src/modules/storage/register";
import { getStorageProvider } from "@/src/modules/storage/provider";

export async function POST(_request:Request,{params}:{params:Promise<{creatorId:string;assetId:string}>}){
  const {creatorId,assetId}=await params;const id=z.string().uuid();if(!id.safeParse(creatorId).success||!id.safeParse(assetId).success)return new NextResponse("Not found",{status:404});
  try{
    return await withAuthorizedCreator(creatorId,async(client,_user,role)=>{
      if(!["owner","admin","editor","platform_admin"].includes(role))return NextResponse.json({error:"forbidden"},{status:403});
      const asset=(await client.query<{storage_provider:string;object_key:string;content_type:string;byte_size:string;status:string}>("SELECT storage_provider,object_key,content_type,byte_size::text,status FROM media_assets WHERE creator_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",[creatorId,assetId])).rows[0];
      if(!asset)return NextResponse.json({error:"not_found"},{status:404});
      if(asset.status==="ready")return NextResponse.json({ok:true,status:"ready"});
      if(asset.status!=="pending")return NextResponse.json({error:"asset_not_pending"},{status:409});
      ensureStorageProvidersRegistered();const provider=getStorageProvider(asset.storage_provider);const info=await provider.inspectObject({creatorId,objectKey:asset.object_key});
      if(!info)return NextResponse.json({error:"object_not_found"},{status:409});
      const expectedSize=Number(asset.byte_size);const actualType=(info.contentType??"").split(";")[0]!.trim().toLowerCase();
      if(info.byteSize!==expectedSize||actualType!==asset.content_type.toLowerCase()){
        await client.query("UPDATE media_assets SET status='quarantined',metadata=metadata||$3::jsonb WHERE creator_id=$1 AND id=$2",[creatorId,assetId,JSON.stringify({verification:{expectedSize,actualSize:info.byteSize,expectedType:asset.content_type,actualType}})]);
        return NextResponse.json({error:"upload_verification_failed"},{status:422});
      }
      await client.query("UPDATE media_assets SET status='ready',metadata=metadata||$3::jsonb WHERE creator_id=$1 AND id=$2",[creatorId,assetId,JSON.stringify({verifiedAt:new Date().toISOString(),storageChecksum:info.checksum??null})]);
      return NextResponse.json({ok:true,status:"ready"});
    });
  }catch(error){console.error("Upload finalization failed",{creatorId,assetId,message:error instanceof Error?error.message:"unknown"});return NextResponse.json({error:"finalize_unavailable"},{status:503});}
}
