"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { creatorQuota, requireCreatorFeature } from "@/src/modules/entitlements/server";
import type { FormState } from "@/app/components/action-form";

const uuid=z.string().uuid();
const creatorId=uuid;
const short=z.string().trim().min(1).max(160);
const writeRoles=new Set(["owner","admin","editor","platform_admin"]);
const manageRoles=new Set(["owner","admin","platform_admin"]);

function fail(error:unknown):FormState{
  const message=error instanceof Error?error.message:"";
  if(message.startsWith("FEATURE_NOT_AVAILABLE:")) return {ok:false,message:`Your current plan does not include ${message.split(":")[1]}.`};
  if(message==="MEMBERSHIP_TIER_LIMIT") return {ok:false,message:"Your membership-tier limit has been reached for this plan."};
  if(message==="ROLE_DENIED") return {ok:false,message:"Your workspace role cannot make this change."};
  console.error("Creator action failed",{message});
  return {ok:false,message:"The change could not be saved. Review the fields and try again."};
}

const schemas={
  branding:z.object({creatorId,operation:z.literal("branding"),name:short,bio:z.string().trim().max(5000),preset:z.enum(["luxury","dark","minimal","glam","lifestyle"]),primaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),secondaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/)}),
  membership:z.object({creatorId,operation:z.literal("membership"),name:short,slug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63),price:z.coerce.number().min(0).max(100000),description:z.string().trim().max(2000)}),
  post:z.object({creatorId,operation:z.literal("post"),title:z.string().trim().max(200),body:z.string().trim().max(20000),postType:z.enum(["text","image","video","gallery","mixed"]),accessType:z.enum(["public","subscriber","membership","ppv"]),membershipTierId:z.union([uuid,z.literal("")]).optional(),price:z.coerce.number().min(0).max(100000).optional(),status:z.enum(["draft","published"])}),
  product:z.object({creatorId,operation:z.literal("product"),name:short,description:z.string().trim().max(3000),productType:z.enum(["ppv","bundle","digital","replay"]),price:z.coerce.number().min(0.5).max(100000)}),
  coupon:z.object({creatorId,operation:z.literal("coupon"),code:z.string().trim().min(2).max(40),discountType:z.enum(["percent","fixed","trial_days"]),discountValue:z.coerce.number().int().min(1).max(100000)}),
  tag:z.object({creatorId,operation:z.literal("tag"),name:short}),
  campaign:z.object({creatorId,operation:z.literal("campaign"),name:short,channel:z.enum(["email","sms","in_app"]),subject:z.string().trim().max(300),body:z.string().trim().min(1).max(30000)}),
  automation:z.object({creatorId,operation:z.literal("automation"),name:short,eventKey:z.string().trim().min(1).max(120),actionKey:z.string().trim().min(1).max(120)}),
  stream:z.object({creatorId,operation:z.literal("stream"),title:short,description:z.string().trim().max(3000),accessType:z.enum(["public","subscriber","membership","ppv"]),membershipTierId:z.union([uuid,z.literal("")]).optional(),price:z.coerce.number().min(0).max(100000).optional(),scheduledFor:z.string().trim().optional(),chatEnabled:z.union([z.literal("on"),z.literal("")]).optional()}),
  domain:z.object({creatorId,operation:z.literal("domain"),hostname:z.string().trim().toLowerCase().min(3).max(253)}),
  payment:z.object({creatorId,operation:z.literal("payment-provider"),provider:z.enum(["ccbill","segpay","stripe"]),merchantReference:z.string().trim().min(1).max(255)}),
};
const actionSchema=z.discriminatedUnion("operation",[
  schemas.branding,schemas.membership,schemas.post,schemas.product,schemas.coupon,schemas.tag,
  schemas.campaign,schemas.automation,schemas.stream,schemas.domain,schemas.payment,
]);

export async function creatorAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=actionSchema.safeParse(Object.fromEntries(form));
  if(!parsed.success) return {ok:false,message:"Check the fields and try again."};
  const data=parsed.data;
  try{
    await withAuthorizedCreator(data.creatorId,async(client,_actor,role)=>{
      if(!writeRoles.has(role)) throw new Error("ROLE_DENIED");
      if(data.operation==="branding"){
        if(!manageRoles.has(role)) throw new Error("ROLE_DENIED");
        const theme=(await client.query<{id:string}>("INSERT INTO creator_themes(creator_id,preset,tokens) VALUES($1,$2,$3::jsonb) RETURNING id",[data.creatorId,data.preset,JSON.stringify({primary:data.primaryColor,secondary:data.secondaryColor,accent:data.accentColor})])).rows[0]!;
        await client.query("UPDATE creators SET name=$2,updated_at=now() WHERE id=$1",[data.creatorId,data.name]);
        await client.query("INSERT INTO creator_settings(creator_id,theme_id,bio,settings) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(creator_id) DO UPDATE SET theme_id=excluded.theme_id,bio=excluded.bio,settings=creator_settings.settings||excluded.settings,updated_at=now()",[data.creatorId,theme.id,data.bio,JSON.stringify({primaryColor:data.primaryColor,secondaryColor:data.secondaryColor,accentColor:data.accentColor})]);
      }else if(data.operation==="membership"){
        await requireCreatorFeature(client,data.creatorId,"membershipTiers");
        const limit=await creatorQuota(client,data.creatorId,"maxMembershipTiers");
        const count=Number((await client.query<{count:string}>("SELECT count(*)::text AS count FROM membership_tiers WHERE creator_id=$1 AND active",[data.creatorId])).rows[0]?.count??0);
        if(count>=limit) throw new Error("MEMBERSHIP_TIER_LIMIT");
        await client.query("INSERT INTO membership_tiers(creator_id,name,slug,description,monthly_price_minor) VALUES($1,$2,$3,$4,$5)",[data.creatorId,data.name,data.slug,data.description,Math.round(data.price*100)]);
      }else if(data.operation==="post"){
        if(data.accessType==="ppv") await requireCreatorFeature(client,data.creatorId,"ppv");
        const post=(await client.query<{id:string}>("INSERT INTO content_posts(creator_id,title,body,post_type,status,access_type,ppv_price_minor,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='published' THEN now() ELSE NULL END) RETURNING id",[data.creatorId,data.title||null,data.body,data.postType,data.status,data.accessType,data.accessType==="ppv"?Math.round((data.price??0)*100):null])).rows[0]!;
        if(data.accessType==="membership"&&data.membershipTierId) await client.query("INSERT INTO content_access_rules(creator_id,post_id,rule_type,membership_tier_id) VALUES($1,$2,'membership',$3)",[data.creatorId,post.id,data.membershipTierId]);
        if(data.accessType==="ppv"){
          const product=(await client.query<{id:string}>("INSERT INTO products(creator_id,name,description,product_type,price_minor) VALUES($1,$2,$3,'ppv',$4) RETURNING id",[data.creatorId,data.title||"PPV post",data.body.slice(0,500),Math.round((data.price??0)*100)])).rows[0]!;
          await client.query("INSERT INTO content_access_rules(creator_id,post_id,rule_type,product_id) VALUES($1,$2,'purchase',$3)",[data.creatorId,post.id,product.id]);
        }
      }else if(data.operation==="product"){
        await requireCreatorFeature(client,data.creatorId,"ppv");
        await client.query("INSERT INTO products(creator_id,name,description,product_type,price_minor) VALUES($1,$2,$3,$4,$5)",[data.creatorId,data.name,data.description,data.productType,Math.round(data.price*100)]);
      }else if(data.operation==="coupon"){
        await requireCreatorFeature(client,data.creatorId,"discounts");
        await client.query("INSERT INTO coupons(creator_id,code,discount_type,discount_value) VALUES($1,$2,$3,$4)",[data.creatorId,data.code.toUpperCase(),data.discountType,data.discountValue]);
      }else if(data.operation==="tag"){
        await requireCreatorFeature(client,data.creatorId,"crm");
        await client.query("INSERT INTO crm_tags(creator_id,name) VALUES($1,$2)",[data.creatorId,data.name]);
      }else if(data.operation==="campaign"){
        if(data.channel==="sms") await requireCreatorFeature(client,data.creatorId,"sms"); else await requireCreatorFeature(client,data.creatorId,"emailAutomation");
        await client.query("INSERT INTO campaigns(creator_id,name,channel,subject,body) VALUES($1,$2,$3,$4,$5)",[data.creatorId,data.name,data.channel,data.subject||null,data.body]);
      }else if(data.operation==="automation"){
        await requireCreatorFeature(client,data.creatorId,"automation");
        const automation=(await client.query<{id:string}>("INSERT INTO automations(creator_id,name) VALUES($1,$2) RETURNING id",[data.creatorId,data.name])).rows[0]!;
        await client.query("INSERT INTO automation_triggers(creator_id,automation_id,event_key) VALUES($1,$2,$3)",[data.creatorId,automation.id,data.eventKey]);
        await client.query("INSERT INTO automation_actions(creator_id,automation_id,action_key) VALUES($1,$2,$3)",[data.creatorId,automation.id,data.actionKey]);
      }else if(data.operation==="stream"){
        await requireCreatorFeature(client,data.creatorId,"live");
        if(data.accessType==="ppv") await requireCreatorFeature(client,data.creatorId,"livePpv");
        if(data.accessType==="membership") await requireCreatorFeature(client,data.creatorId,"livePrivateTiers");
        const when=data.scheduledFor?new Date(data.scheduledFor):null;
        if(when&&Number.isNaN(when.getTime())) throw new Error("INVALID_DATE");
        await client.query("INSERT INTO live_streams(creator_id,provider,title,description,access_type,membership_tier_id,ppv_price_minor,chat_enabled,scheduled_for,status) VALUES($1,'unconfigured',$2,$3,$4,$5,$6,$7,$8,'scheduled')",[data.creatorId,data.title,data.description,data.accessType,data.membershipTierId||null,data.accessType==="ppv"?Math.round((data.price??0)*100):null,data.chatEnabled==="on",when]);
      }else if(data.operation==="domain"){
        if(!manageRoles.has(role)) throw new Error("ROLE_DENIED");
        await requireCreatorFeature(client,data.creatorId,"customDomains");
        await client.query("INSERT INTO creator_domains(creator_id,hostname,status,is_primary) VALUES($1,$2,'pending',false)",[data.creatorId,data.hostname]);
      }else if(data.operation==="payment-provider"){
        if(!manageRoles.has(role)) throw new Error("ROLE_DENIED");
        await client.query("INSERT INTO payment_provider_accounts(creator_id,provider,merchant_reference,status) VALUES($1,$2,$3,'pending') ON CONFLICT(creator_id,provider,merchant_reference) DO NOTHING",[data.creatorId,data.provider,data.merchantReference]);
      }
    });
  }catch(error){return fail(error);}
  revalidatePath(`/dashboard/${data.creatorId}`,"layout");
  return {ok:true,message:"Saved successfully."};
}
