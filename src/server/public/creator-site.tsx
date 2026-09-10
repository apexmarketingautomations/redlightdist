import type { CSSProperties } from "react";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { normalizeHostname } from "@/src/modules/tenants/hostname";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { withCreator } from "@/src/server/db/scoped";
import { resolveTheme, themeCssVariables, type ThemePreset, type ThemeTokens } from "@/src/modules/themes/presets";
import { FanAccountPage, FanAuthPage } from "@/src/server/fans/pages";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { canFanAccessPost } from "@/src/modules/content/access";

const money=(minor:number,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(minor/100);
const knownTokenOverrides=(settings:Record<string,string>,tokens:Record<string,string>|null):Partial<ThemeTokens>=>{
  const source={...(tokens??{}),primary:settings.primaryColor,secondary:settings.secondaryColor,accent:settings.accentColor};
  const allowed=["fontHeading","fontBody","radius","background","surface","text","muted","primary","secondary","accent","buttonText","gridGap"] as const;
  return Object.fromEntries(allowed.flatMap(key=>source[key]?[ [key,source[key]] ]:[])) as Partial<ThemeTokens>;
};

export async function PublicCreatorSite({hostname,path=[],token}:{hostname:string;path?:string[];token?:string}){
  const actual=normalizeHostname((await headers()).get("host")??"");
  const requested=normalizeHostname(decodeURIComponent(hostname));
  if(!actual||!requested||actual!==requested)notFound();
  const creatorId=await resolveCreatorIdForHost(actual); if(!creatorId)notFound();
  const data=await withCreator(creatorId,async client=>{
    const creator=(await client.query<{name:string;slug:string;vertical:string}>("SELECT name,slug,vertical FROM creators WHERE id=$1 AND status='active' AND deleted_at IS NULL",[creatorId])).rows[0];
    if(!creator)return null;
    const settings=(await client.query<{bio:string;social_links:Record<string,string>;age_gate_enabled:boolean;currency:string;settings:Record<string,string>;preset:string|null;tokens:Record<string,string>|null}>("SELECT s.bio,s.social_links,s.age_gate_enabled,s.currency,s.settings,t.preset,t.tokens FROM creator_settings s LEFT JOIN creator_themes t ON t.creator_id=s.creator_id AND t.id=s.theme_id WHERE s.creator_id=$1",[creatorId])).rows[0];
    if(!settings)return null;
    const tiers=(await client.query<{id:string;name:string;description:string;monthly_price_minor:number;currency:string}>("SELECT id,name,description,monthly_price_minor,currency FROM membership_tiers WHERE creator_id=$1 AND active ORDER BY position,name",[creatorId])).rows;
    const posts=(await client.query<{id:string;title:string|null;body:string;post_type:string;access_type:string;published_at:Date|null;product_id:string|null;price_minor:number|null;currency:string|null}>(`SELECT p.id,p.title,p.body,p.post_type,p.access_type,p.published_at,r.product_id,pr.price_minor,pr.currency FROM content_posts p
      LEFT JOIN content_access_rules r ON r.creator_id=p.creator_id AND r.post_id=p.id AND r.rule_type='purchase'
      LEFT JOIN products pr ON pr.creator_id=r.creator_id AND pr.id=r.product_id
      WHERE p.creator_id=$1 AND p.status='published' ORDER BY p.published_at DESC NULLS LAST,p.created_at DESC LIMIT 60`,[creatorId])).rows;
    return{creator,settings,tiers,posts};
  });
  if(!data)notFound();
  const preset=(data.settings.preset??"dark") as ThemePreset;
  const tokens=resolveTheme(preset,knownTokenOverrides(data.settings.settings??{},data.settings.tokens));
  const style=themeCssVariables(tokens) as CSSProperties;
  const route=path.join("/");
  if(route==="terms"||route==="privacy"||route==="compliance")return <LegalPage kind={route} creatorName={data.creator.name} style={style}/>;
  if(route==="fan/login")return <FanAuthPage creatorName={data.creator.name} mode="login" style={style}/>;
  if(route==="fan/register")return <FanAuthPage creatorName={data.creator.name} mode="register" style={style}/>;
  if(route==="fan/forgot-password")return <FanAuthPage creatorName={data.creator.name} mode="forgot" style={style}/>;
  if(route==="fan/reset-password")return <FanAuthPage creatorName={data.creator.name} mode="reset" style={style} token={token}/>;
  if(route==="fan/account")return <FanAccountPage creatorId={creatorId} creatorName={data.creator.name} style={style}/>;
  if(route.startsWith("content/"))return <ContentDetail creatorId={creatorId} creatorName={data.creator.name} postId={route.slice(8)} style={style}/>;

  const ageAccepted=(await cookies()).get("creator_age_gate")?.value==="accepted";
  if(data.settings.age_gate_enabled&&!ageAccepted)return <AgeGate creatorName={data.creator.name} returnTo={`/${route}`} style={style}/>;
  const fan=await getCurrentFan();
  return <main className={`creator-site theme-${preset}`} style={style}>
    <header className="creator-site-nav"><a className="creator-site-logo" href="/">{data.creator.name}</a><nav><a href="#content">Content</a><a href="#memberships">Memberships</a>{fan?.creatorId===creatorId?<a className="creator-primary" href="/fan/account">My account</a>:<><a href="/fan/login">Log in</a><a className="creator-primary" href="/fan/register">Join</a></>}</nav></header>
    <section className="creator-hero"><div className="creator-hero-copy"><span className="creator-kicker">Independent creator · {data.creator.vertical}</span><h1>{data.creator.name}</h1><p>{data.settings.bio||"Exclusive content, memberships and direct access — on the creator's own brand."}</p><div className="creator-hero-actions"><a className="creator-primary" href="#memberships">Subscribe</a><a className="creator-secondary" href="#content">View content</a></div></div><div className="creator-cover-placeholder"><span>{data.creator.name.slice(0,1).toUpperCase()}</span></div></section>
    <section id="content" className="creator-section"><div className="creator-section-heading"><div><small>Latest</small><h2>Creator feed</h2></div><p>Public previews and member content from this creator.</p></div><div className="creator-content-grid">{data.posts.length?data.posts.map(post=><article className="creator-post" key={post.id}><a href={`/content/${post.id}`}><div className="creator-post-media"><span>{post.post_type}</span></div><div className="creator-post-copy"><small>{post.access_type==="public"?"PUBLIC":post.access_type.toUpperCase()}</small><h3>{post.title||"New post"}</h3>{post.access_type==="public"?<p>{post.body}</p>:<p className="creator-locked">Locked — open to verify access{post.price_minor!==null&&post.currency?` · ${money(post.price_minor,post.currency)}`:""}.</p>}</div></a></article>):<div className="creator-empty">No posts published yet.</div>}</div></section>
    <section id="memberships" className="creator-section creator-memberships"><div className="creator-section-heading"><div><small>Membership</small><h2>Choose your access</h2></div><p>Subscribe directly to {data.creator.name}.</p></div><div className="creator-tier-grid">{data.tiers.length?data.tiers.map((tier,index)=><article className="creator-tier" key={tier.id}><small>{index===0?"MEMBERSHIP":"PREMIUM ACCESS"}</small><h3>{tier.name}</h3><strong>{money(tier.monthly_price_minor,tier.currency)}<span>/month</span></strong><p>{tier.description||"Subscriber-only creator access."}</p><form method="post" action="/api/commerce/subscribe"><input type="hidden" name="tierId" value={tier.id}/><button className="creator-primary" type="submit">Choose {tier.name}</button></form></article>):<div className="creator-empty">Membership pricing is being configured.</div>}</div></section>
    <footer className="creator-site-footer"><strong>{data.creator.name}</strong><nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/compliance">Safety & reporting</a></nav><small>Powered by Redlight white-label creator infrastructure.</small></footer>
  </main>;
}

async function ContentDetail({creatorId,creatorName,postId,style}:{creatorId:string;creatorName:string;postId:string;style:CSSProperties}){
  const fan=await getCurrentFan();
  const data=await withCreator(creatorId,async client=>{
    const decision=await canFanAccessPost(client,{creatorId,postId,fanId:fan?.creatorId===creatorId?fan.id:null});
    const post=(await client.query<{id:string;title:string|null;body:string;post_type:string;access_type:string;product_id:string|null;price_minor:number|null;currency:string|null}>(`SELECT p.id,p.title,p.body,p.post_type,p.access_type,r.product_id,pr.price_minor,pr.currency FROM content_posts p LEFT JOIN content_access_rules r ON r.creator_id=p.creator_id AND r.post_id=p.id AND r.rule_type='purchase' LEFT JOIN products pr ON pr.creator_id=r.creator_id AND pr.id=r.product_id WHERE p.creator_id=$1 AND p.id=$2 AND p.status='published' LIMIT 1`,[creatorId,postId])).rows[0];
    const media=decision.allowed?(await client.query<{id:string;kind:string}>("SELECT m.id,m.kind FROM post_media pm JOIN media_assets m ON m.creator_id=pm.creator_id AND m.id=pm.media_asset_id WHERE pm.creator_id=$1 AND pm.post_id=$2 AND m.status='ready' AND m.deleted_at IS NULL ORDER BY pm.position",[creatorId,postId])).rows:[];
    return{decision,post,media};
  });
  if(!data.post)notFound();
  return <main className="creator-site creator-legal" style={style}><section><a href="/">← {creatorName}</a><small>{data.post.access_type.toUpperCase()}</small><h1>{data.post.title||"Creator post"}</h1>{data.decision.allowed?<><p className="creator-content-body">{data.post.body}</p>{data.media.map(asset=><div key={asset.id} className="creator-protected-media"><a className="creator-primary" href={`/api/media/${asset.id}`}>Open protected {asset.kind}</a></div>)}</>:<><p>This content is locked. Access is checked against your active membership or settled purchase on the server.</p>{data.post.access_type==="ppv"&&data.post.product_id&&<form method="post" action="/api/commerce/purchase"><input type="hidden" name="productId" value={data.post.product_id}/><button className="creator-primary" type="submit">Unlock {data.post.price_minor!==null&&data.post.currency?money(data.post.price_minor,data.post.currency):"content"}</button></form>}{!fan&&<a className="creator-secondary" href="/fan/login">Log in</a>}</>}</section></main>;
}

function AgeGate({creatorName,returnTo,style}:{creatorName:string;returnTo:string;style:CSSProperties}){return <main className="creator-site creator-gate" style={style}><section><small>AGE / ACCESS NOTICE</small><h1>{creatorName}</h1><p>This creator has enabled an age gate. Continue only if you meet the minimum age required to access this site in your jurisdiction.</p><form method="post" action="/api/age-gate"><input type="hidden" name="returnTo" value={returnTo||"/"}/><button className="creator-primary" type="submit">I meet the age requirement</button></form><a href="https://www.google.com">Exit</a></section></main>}
function LegalPage({kind,creatorName,style}:{kind:string;creatorName:string;style:CSSProperties}){const copy=kind==="terms"?"Terms are configured for this creator and platform deployment. Production legal text must be reviewed and versioned before launch.":kind==="privacy"?"Privacy disclosures, consent records and retention requirements are configurable. Production policy text requires approved legal review.":"This platform prohibits minors, non-consensual content, sexual exploitation, trafficking and illegal material. Reporting, takedown and emergency removal workflows are part of the platform compliance system.";return <main className="creator-site creator-legal" style={style}><section><a href="/">← {creatorName}</a><h1>{kind==="terms"?"Terms":kind==="privacy"?"Privacy":"Safety & reporting"}</h1><p>{copy}</p>{kind==="compliance"&&<p>Production reporting contacts and jurisdiction-specific procedures must be configured by the platform operator and qualified counsel.</p>}</section></main>}
