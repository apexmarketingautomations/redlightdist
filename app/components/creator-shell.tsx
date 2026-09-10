import type { ReactNode } from "react";

const navigation=[
  ["overview","Overview"],["content","Content"],["subscribers","Subscribers"],["fans","Customers / Fans"],
  ["memberships","Memberships"],["ppv","PPV"],["products","Products"],["revenue","Revenue"],["analytics","Analytics"],
  ["marketing","Marketing"],["discounts","Discounts"],["referrals","Referrals"],["messages","Messages / Notifications"],
  ["livestreams","Livestreams"],["settings","Settings"],["domain","Domain"],["branding","Branding"],["payments","Payment settings"],
  ["compliance","Compliance"],["billing","Plan / Billing"],
] as const;

export function CreatorShell({creatorId,creatorName,plan,section,admin=false,children}:{creatorId:string;creatorName:string;plan:string;section:string;admin?:boolean;children:ReactNode}){
  const base=`/dashboard/${creatorId}`;
  return <main className="office creator-office">
    <header className="office-header"><a className="office-brand" href="/dashboard">REDLIGHT <span>CREATOR</span></a><div className="office-header-actions"><span className="office-badge">{plan}</span>{admin&&<a className="office-button quiet" href={`/admin/clients/${creatorId}`}>Admin controls</a>}<form action="/api/auth/logout" method="post"><button className="office-button quiet" type="submit">Log out</button></form></div></header>
    <div className="creator-console-layout">
      <aside className="creator-sidebar"><div className="creator-sidebar-title"><strong>{creatorName}</strong><small>Creator workspace</small></div><nav aria-label="Creator dashboard">{navigation.map(([key,label])=><a key={key} className={section===key?"active":""} href={key==="overview"?base:`${base}/${key}`}>{label}</a>)}<a href="/account">Account</a><a href="/">Platform website</a></nav></aside>
      <section className="creator-console-main">{children}</section>
    </div>
  </main>;
}
