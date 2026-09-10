import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { withCreator } from "@/src/server/db/scoped";

const schema=z.object({name:z.string().trim().min(1).max(200),email:z.string().trim().email().max(320),contentReference:z.string().trim().min(1).max(2000),basis:z.string().trim().min(20).max(10000)});
export async function POST(request:Request){
  const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});
  const parsed=schema.safeParse(Object.fromEntries(await request.formData()));if(!parsed.success)return new NextResponse("Invalid takedown request",{status:400});
  await withCreator(tenant.creatorId,async client=>{
    await client.query("INSERT INTO takedown_requests(creator_id,requester_name,requester_email,content_reference,basis,status) VALUES($1,$2,$3,$4,$5,'open')",[tenant.creatorId,parsed.data.name,parsed.data.email,parsed.data.contentReference,parsed.data.basis]);
    await client.query("SELECT raise_current_tenant_alert('warning','takedown_request','New takedown request',$1,$2::jsonb)",["A new takedown request requires review.",JSON.stringify({requesterEmail:parsed.data.email,contentReference:parsed.data.contentReference})]);
  });
  return NextResponse.redirect(new URL("/compliance?submitted=1",request.url),303);
}
