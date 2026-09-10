import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { creatorQuota, requireCreatorFeature } from "@/src/modules/entitlements/server";
import { assertMediaType, assertUploadSize, getStorageProvider } from "@/src/modules/storage/provider";
import { ensureStorageProvidersRegistered } from "@/src/modules/storage/register";

const allowedTypes=["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime","audio/mpeg","audio/mp4"] as const;
const schema=z.object({filename:z.string().trim().min(1).max(255),contentType:z.enum(allowedTypes),byteSize:z.number().int().positive(),checksumSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional()});
const extension:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov","audio/mpeg":"mp3","audio/mp4":"m4a"};

export async function POST(request:Request,{params}:{params:Promise<{creatorId:string}>}){
  const {creatorId}=await params;if(!z.string().uuid().safeParse(creatorId).success)return new NextResponse("Not found",{status:404});
  let json:unknown;try{json=await request.json();}catch{return NextResponse.json({error:"invalid_json"},{status:400});}
  const parsed=schema.safeParse(json);if(!parsed.success)return NextResponse.json({error:"invalid_upload"},{status:400});
  try{
    return await withAuthorizedCreator(creatorId,async(client,_user,role)=>{
      if(!["owner","admin","editor","platform_admin"].includes(role))return NextResponse.json({error:"forbidden"},{status:403});
      await requireCreatorFeature(client,creatorId,"media");
      const maxStorage=await creatorQuota(client,creatorId,"maxStorageBytes");const maxVideo=await creatorQuota(client,creatorId,"maxVideoBytes");
      const isVideo=parsed.data.contentType.startsWith("video/");const singleLimit=isVideo?maxVideo:Math.min(maxStorage,100*1024*1024);
      assertMediaType(parsed.data.contentType,allowedTypes);assertUploadSize(parsed.data.byteSize,singleLimit);
      const used=Number((await client.query<{bytes:string}>("SELECT coalesce(sum(byte_size),0)::text AS bytes FROM media_assets WHERE creator_id=$1 AND deleted_at IS NULL AND status IN ('pending','ready')",[creatorId])).rows[0]?.bytes??0);
      if(used+parsed.data.byteSize>maxStorage)return NextResponse.json({error:"storage_quota_exceeded",limit:maxStorage,used},{status:409});
      const id=randomUUID();const ext=extension[parsed.data.contentType]??"bin";const objectKey=`creators/${creatorId}/${new Date().getUTCFullYear()}/${id}.${ext}`;
      ensureStorageProvidersRegistered();const provider=getStorageProvider("s3");
      const signed=await provider.createUpload({creatorId,objectKey,contentType:parsed.data.contentType,byteSize:parsed.data.byteSize,checksumSha256:parsed.data.checksumSha256});
      const kind=parsed.data.contentType.startsWith("image/")?"image":parsed.data.contentType.startsWith("video/")?"video":"audio";
      await client.query(`INSERT INTO media_assets(id,creator_id,storage_provider,object_key,kind,content_type,original_filename,byte_size,checksum_sha256,visibility,status,metadata)
        VALUES($1,$2,'s3',$3,$4,$5,$6,$7,$8,'private','pending',$9::jsonb)`,[id,creatorId,objectKey,kind,parsed.data.contentType,parsed.data.filename,parsed.data.byteSize,parsed.data.checksumSha256??null,JSON.stringify({uploadExpiresAt:signed.expiresAt.toISOString()})]);
      return NextResponse.json({assetId:id,uploadUrl:signed.url,headers:signed.headers??{},expiresAt:signed.expiresAt.toISOString()},{status:201,headers:{"cache-control":"no-store"}});
    });
  }catch(error){const message=error instanceof Error?error.message:"unknown";console.error("Upload initialization failed",{creatorId,message});return NextResponse.json({error:message==="S3_STORAGE_NOT_CONFIGURED"?"storage_not_configured":"upload_unavailable"},{status:503});}
}
