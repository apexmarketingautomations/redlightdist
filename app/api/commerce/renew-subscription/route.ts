import { NextResponse } from "next/server";
import { z } from "zod";
import { requestTenant } from "@/src/server/fans/request";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { withCreator } from "@/src/server/db/scoped";

const schema=z.object({subscriptionId:z.string().uuid()});
export async function POST(request:Request){const tenant=await requestTenant(request);if(!tenant)return new NextResponse("Tenant not found",{status:404});const fan=await getCurrentFan();if(!fan||fan.creatorId!==tenant.creatorId)return NextResponse.redirect(new URL("/fan/login",request.url),303);const parsed=schema.safeParse(Object.fromEntries(await request.formData()));if(!parsed.success)return new NextResponse("Invalid subscription request",{status:400});
  try{await withCreator(tenant.creatorId,async client=>{const sub=(await client.query<{id:string;status:string}>("SELECT id,status FROM creator_subscriptions WHERE creator_id=$1 AND id=$2 AND fan_id=$3 FOR UPDATE",[tenant.creatorId,parsed.data.subscriptionId,fan.id])).rows[0];if(!sub||!["active","trialing","past_due","cancelled","expired"].includes(sub.status))throw new Error("SUBSCRIPTION_NOT_RENEWABLE");await client.query("UPDATE subscription_change_requests SET status='cancelled',processed_at=now() WHERE creator_id=$1 AND creator_subscription_id=$2 AND request_type='cancel' AND status='pending'",[tenant.creatorId,sub.id]);await client.query("INSERT INTO subscription_change_requests(creator_id,fan_id,creator_subscription_id,request_type,status) VALUES($1,$2,$3,'renew','pending') ON CONFLICT DO NOTHING",[tenant.creatorId,fan.id,sub.id]);});}catch(error){console.error("Renewal request failed",error);return new NextResponse("Renewal request could not be recorded.",{status:409});}
  return NextResponse.redirect(new URL("/fan/account?notice=renewal-pending",request.url),303);
}
