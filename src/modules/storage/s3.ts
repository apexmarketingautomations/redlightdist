import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { SignedDownload, SignedUpload, StorageProvider, UploadRequest } from "./provider";

const enc=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const hmac=(key:Buffer|string,value:string)=>createHmac("sha256",key).update(value).digest();

type S3Config={endpoint:string;region:string;bucket:string;accessKeyId:string;secretAccessKey:string;pathStyle:boolean};
function config():S3Config{
  const endpoint=process.env.S3_ENDPOINT?.replace(/\/$/,"");
  const region=process.env.S3_REGION||"us-east-1";
  const bucket=process.env.S3_BUCKET;
  const accessKeyId=process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey=process.env.S3_SECRET_ACCESS_KEY;
  if(!endpoint||!bucket||!accessKeyId||!secretAccessKey)throw new Error("S3_STORAGE_NOT_CONFIGURED");
  return{endpoint,region,bucket,accessKeyId,secretAccessKey,pathStyle:process.env.S3_PATH_STYLE!=="false"};
}
function timestamp(now=new Date()){
  const iso=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
  return{amzDate:iso,dateStamp:iso.slice(0,8)};
}
function objectUrl(c:S3Config,key:string){
  const clean=key.split("/").filter(Boolean).map(enc).join("/");
  if(c.pathStyle)return new URL(`${c.endpoint}/${enc(c.bucket)}/${clean}`);
  const base=new URL(c.endpoint);base.hostname=`${c.bucket}.${base.hostname}`;base.pathname=`/${clean}`;return base;
}
function presign(method:"GET"|"PUT"|"DELETE",key:string,expires:number){
  const c=config();const url=objectUrl(c,key);const {amzDate,dateStamp}=timestamp();
  const scope=`${dateStamp}/${c.region}/s3/aws4_request`;
  const params:Record<string,string>={
    "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
    "X-Amz-Credential":`${c.accessKeyId}/${scope}`,
    "X-Amz-Date":amzDate,
    "X-Amz-Expires":String(Math.max(1,Math.min(3600,expires))),
    "X-Amz-SignedHeaders":"host",
  };
  const canonicalQuery=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${enc(k)}=${enc(v)}`).join("&");
  const canonicalRequest=[method,url.pathname,canonicalQuery,`host:${url.host}\n`,"host","UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign=["AWS4-HMAC-SHA256",amzDate,scope,sha(canonicalRequest)].join("\n");
  const kDate=hmac(`AWS4${c.secretAccessKey}`,dateStamp);const kRegion=hmac(kDate,c.region);const kService=hmac(kRegion,"s3");const kSigning=hmac(kService,"aws4_request");
  const signature=createHmac("sha256",kSigning).update(stringToSign).digest("hex");
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set("X-Amz-Signature",signature);
  return url.toString();
}

export const s3StorageProvider:StorageProvider={
  name:"s3",
  async createUpload(request:UploadRequest):Promise<SignedUpload>{
    const expires=300;return{url:presign("PUT",request.objectKey,expires),expiresAt:new Date(Date.now()+expires*1000)};
  },
  async createDownload(input):Promise<SignedDownload>{
    const expires=Math.max(1,Math.min(900,input.expiresInSeconds));return{url:presign("GET",input.objectKey,expires),expiresAt:new Date(Date.now()+expires*1000)};
  },
  async deleteObject(input){
    const response=await fetch(presign("DELETE",input.objectKey,60),{method:"DELETE"});
    if(!response.ok&&response.status!==404)throw new Error(`S3_DELETE_FAILED:${response.status}`);
  },
};
