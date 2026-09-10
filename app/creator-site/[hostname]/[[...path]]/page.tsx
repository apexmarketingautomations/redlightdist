import type { CSSProperties } from "react";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { normalizeHostname } from "@/src/modules/tenants/hostname";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { withCreator } from "@/src/server/db/scoped";
import { resolveTheme, themeCssVariables, type ThemePreset } from "@/src/modules/themes/presets";

const money=(minor:number,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(minor/100);

export default async function CreatorSitePage({params}:{params:Promise<{hostname:string;path?:string[]}>}){
  const {hostname,path=[]}=await params;
  const actual=normalizeHostname((await headers()).get("host")??"");
  const requested=normalizeHostname(decodeURIComponent(hostname));
  if(!actual||!requested||actual!==requested) notFound();
  const creatorId=await resolveCreatorIdForHost(actual); if(!creatorId) notFound();
  const data=await withCreator(creatorId,async client=>{
    const creator=(await client.query<{name:string;slug:string;vertical:string}>("SELECT name,slug,vertical FROM creators WHERE id=$1 AND status='active' AND deleted_at IS NULL",[creatorId])).rows[0];
    if(!creator) return null;
    const settings=(await client.query<{bio:string;social_links:Record<string,string>;age_gate_enabled:boolean;currency:string;settings:Record<string,string>;preset:string|null;tokens:Record<string,string>|null}>("SELECT s.bio,s.social_links,s.age_gate_enabled,s.currency,s.settings,t.preset,t.tokens FROM creator_settings s LEFT JOIN creator_themes t ON t.creator_id=s.creator_id AND t.id=s.theme_id WHERE s.creator_id=$1",[creatorId])).rows[0];
    if(!settings) return null;
    const tiers=(await client.query<{id:string;name:string;description:string;monthly_price_minor:number;currency:string;benefits:unknown}>("SELECT id,name,description,monthly_price_minor,currency,benefits FROM membership_tiers WHERE creator_id=$1 AND active ORDER BY position,name",[creatorId])).rows;
    const posts=(await client.query<{id:string;title:string|null;body:string;post_type:string;access_type:string;published_at:Date|null}>("SELECT id,title,body,post_type,access_type,published_at FROM content_posts WHERE creator_id=$1 AND status='published' ORDER BY published_at DESC NULLS LAST,created_at DESC LIMIT 60",[creatorId])).rows;
    return {creator,settings,tiers,posts};
  });
  if(!data) notFound();

  const preset=(data.settings.preset??"dark") as ThemePreset;
  const s=data.settings.settings??{};
  const tokens=resolveTheme(preset,{primary:s.primaryColor,secondary:s.secondaryColor,accent:s.accentColor,...(data.settings.tokens??{})});
  const style=themeCssVariables(tokens) as CSSProperties;
  const route=path.join("/");
  if(route==="terms"||route==="privacy"||route==="compliance") return <LegalPage kind={route} creatorName={data.creator.name} style={style}/>;
  if(route==="fan/login") return <FanAuth creatorName={data.creator.name} mode="login" style={style}/>;
  if(route==="fan/register") return <FanAuth creatorName={data.creator.name} mode="register" style={style}/>;

  const ageAccepted=(await cookies()).get("creator_age_gate")?.value==="accepted";
  if(data.settings.age_gate_enabled&&!ageAccepted) return <AgeGate creatorName={data.creator.name} returnTo={`/${route}`} style={style}/>;
  return <main className={`creator-site theme-${preset}`} style={style}>
    <header className="creator-site-nav"><a className="creator-site-logo" href="/">{data.creator.name}</a><nav><a href="#content">Content</a><a href="#memberships">Memberships</a><a href="/fan/login">Log in</a><a className="creator-primary" href="/fan/register">Join</a></nav></header>
    <section className="creator-hero"><div className="creator-hero-copy"><span className="creator-kicker">Independent creator · {data.creator.vertical}</span><h1>{data.creator.name}</h1><p>{data.settings.bio||"Exclusive content, memberships and direct access — on the creator's own brand."}</p><div className="creator-hero-actions"><a className="creator-primary" href="#memberships">Subscribe</a><a className="creator-secondary" href="#content">View content</a></div></div><div className="creator-cover-placeholder"><span>{data.creator.name.slice(0,1).toUpperCase()}</span></div></section>
    <section id="content" className="creator-section"><div className="creator-section-heading"><div><small>Latest</small><h2>Creator feed</h2></div><p>Public previews and member content from this creator.</p></div><div className="creator-content-grid">{data.posts.length?data.posts.map(post=><article className="creator-post" key={post.id}><div className="creator-post-media"><span>{post.post_type}</span></div><div className="creator-post-copy"><small>{post.access_type==="public"?"PUBLIC":post.access_type.toUpperCase()}</small><h3>{post.title||"New post"}</h3>{post.access_type==="public"?<p>{post.body}</p>:<p className="creator-locked">Locked for eligible members or purchasers.</p>}</div></article>):<div className="creator-empty">No posts published yet.</div>}</div></section>
    <section id="memberships" className="creator-section creator-memberships"><div className="creator-section-heading"><div><small>Membership</small><h2>Choose your access</h2></div><p>Subscribe directly to {data.creator.name}.</p></div><div className="creator-tier-grid">{data.tiers.length?data.tiers.map((tier,index)=><article className="creator-tier" key={tier.id}><small>{index===0?"MEMBERSHIP":"PREMIUM ACCESS"}</small><h3>{tier.name}</h3><strong>{money(tier.monthly_price_minor,tier.currency)}<span>/month</span></strong><p>{tier.description||"Subscriber-only creator access."}</p><a className="creator-primary" href="/fan/register">Choose {tier.name}</a></article>):<div className="creator-empty">Membership pricing is being configured.</div>}</div></section>
    <footer className="creator-site-footer"><strong>{data.creator.name}</strong><nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/compliance">Safety & reporting</a></nav><small>Powered by Redlight white-label creator infrastructure.</small></footer>
  </main>;
}

function AgeGate({creatorName,returnTo,style}:{creatorName:string;returnTo:string;style:CSSProperties}){return <main className="creator-site creator-gate" style={style}><section><small>AGE / ACCESS NOTICE</small><h1>{creatorName}</h1><p>This creator has enabled an age gate. Continue only if you meet the minimum age required to access this site in your jurisdiction.</p><form method="post" action="/api/age-gate"><input type="hidden" name="returnTo" value={returnTo||"/"}/><button className="creator-primary" type="submit">I meet the age requirement</button></form><a href="https://www.google.com">Exit</a></section></main>}
function FanAuth({creatorName,mode,style}:{creatorName:string;mode:"login"|"register";style:CSSProperties}){return <main className="creator-site creator-auth" style={style}><section><a href="/">← {creatorName}</a><small>{mode==="login"?"FAN LOGIN":"CREATE FAN ACCOUNT"}</small><h1>{mode==="login"?"Welcome back":"Join the community"}</h1><form method="post" action={`/api/fan/${mode}`}><label>Email<input type="email" name="email" required autoComplete="email"/></label><label>Password<input type="password" name="password" required minLength={12} autoComplete={mode==="login"?"current-password":"new-password"}/></label><button className="creator-primary" type="submit">{mode==="login"?"Log in":"Create account"}</button></form><p>{mode==="login"?<>New here? <a href="/fan/register">Create an account</a>.</>:<>Already registered? <a href="/fan/login">Log in</a>.</>}</p></section></main>}
function LegalPage({kind,creatorName,style}:{kind:string;creatorName:string;style:CSSProperties}){const copy=kind==="terms"?"Terms are configured for this creator and platform deployment. Production legal text must be reviewed and versioned before launch.":kind==="privacy"?"Privacy disclosures, consent records and retention requirements are configurable. Production policy text requires approved legal review.":"This platform prohibits minors, non-consensual content, sexual exploitation, trafficking and illegal material. Reporting, takedown and emergency removal workflows are part of the platform compliance system.";return <main className="creator-site creator-legal" style={style}><section><a href="/">← {creatorName}</a><h1>{kind==="terms"?"Terms":kind==="privacy"?"Privacy":"Safety & reporting"}</h1><p>{copy}</p>{kind==="compliance"&&<p>For production deployments, reporting contact details and jurisdiction-specific procedures must be configured by the platform operator and counsel.</p>}</section></main>}
