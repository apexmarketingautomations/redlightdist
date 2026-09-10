import { ArrowRight, BarChart3, Check, CircleDollarSign, Globe2, LockKeyhole, Palette, ShieldCheck, Sparkles, Users } from "lucide-react";

const plans = [
  { name: "Starter", price: "$149", note: "For creators building their first owned platform", featured: false, features: ["Custom domain and branded profile", "Paid subscriber-only posts", "One membership tier", "Photo and video publishing", "Fan accounts and creator dashboard"] },
  { name: "Pro", price: "$299", note: "For creators ready to grow revenue", featured: true, features: ["Everything in Starter", "Multiple tiers, PPV, tips and bundles", "Fan CRM and segmentation", "Discounts, trials and referrals", "Advanced revenue and content analytics"] },
  { name: "Elite", price: "From $599", note: "For scaled and managed creator brands", featured: false, features: ["Everything in Pro", "Marketing automation and campaigns", "Advanced CRM and attribution", "Custom pages, themes and workflows", "Priority support and managed services"] },
];

const features = [
  { icon: Globe2, title: "Your domain", text: "Launch every creator under their own domain and branding from one shared platform." },
  { icon: CircleDollarSign, title: "Flexible revenue", text: "Subscriptions, PPV, tips and offers through a provider-independent payment layer." },
  { icon: Users, title: "Own the relationship", text: "Fan accounts, consent-aware CRM, segmentation and direct audience insights." },
  { icon: LockKeyhole, title: "Protected content", text: "Server-authorized access and temporary delivery for private photos, videos and streams." },
  { icon: BarChart3, title: "Actionable analytics", text: "Understand subscriptions, content performance, conversion and revenue in one place." },
  { icon: ShieldCheck, title: "Compliance controls", text: "Configurable identity, consent, reporting, takedown and audit workflows." },
];

export default function Home() {
  return <main>
    <nav className="nav shell">
      <a className="brand" href="#top" aria-label="Redlight home"><span className="brand-mark">R</span>REDLIGHT</a>
      <div className="nav-links"><a href="#platform">Platform</a><a href="#pricing">Pricing</a><a href="#security">Security</a></div>
      <div className="nav-actions"><a className="nav-login" href="/login">Log in</a><a className="nav-cta" href="#pricing">Launch your site <ArrowRight size={16}/></a></div>
    </nav>

    <section className="hero shell" id="top">
      <div className="eyebrow"><Sparkles size={15}/> The creator platform that belongs to you</div>
      <h1>Own your audience.<br/><span>Own your revenue.</span></h1>
      <p className="hero-copy">Launch a premium subscription website under your own name, domain and visual identity—with the tools to publish, monetize and grow.</p>
      <div className="hero-actions"><a className="primary" href="#pricing">Choose your plan <ArrowRight size={18}/></a><a className="secondary" href="#platform">Explore the platform</a></div>
      <div className="brand-stage" aria-label="One platform powers distinct creator brands">
        <div className="stage-head"><span>ONE PLATFORM</span><span className="live-dot">Built for independent brands</span></div>
        <div className="site-cards">
          <article className="site-card luxury"><small>LUXURY</small><strong>Monroe</strong><span>monroe.com</span></article>
          <article className="site-card dark"><small>DARK</small><strong>NOIR</strong><span>noir.world</span></article>
          <article className="site-card glam"><small>GLAM</small><strong>Ari Rose</strong><span>arirose.com</span></article>
          <article className="site-card lifestyle"><small>LIFESTYLE</small><strong>Move with Mia</strong><span>movewithmia.com</span></article>
        </div>
        <p>New creator. New identity. Same secure core.</p>
      </div>
    </section>

    <section className="platform shell" id="platform">
      <div className="section-lead"><div><span className="kicker">THE PLATFORM</span><h2>Everything behind your brand.</h2></div><p>Built once, configured for every creator. Change the domain, theme, pricing and content without rebuilding the product.</p></div>
      <div className="feature-grid">{features.map(({icon: Icon,title,text})=><article key={title}><Icon/><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section className="comparison-wrap">
      <div className="comparison shell">
        <span className="kicker">A BETTER FOUNDATION</span><h2>Your business deserves more than a marketplace profile.</h2>
        <div className="compare-grid"><div><h3>Traditional platforms</h3>{["Their brand comes first","One-size-fits-all profile","Limited customer insight","Platform-controlled experience"].map(x=><p key={x}>{x}</p>)}</div><div className="ours"><h3>Redlight</h3>{["Your brand and domain","Five adaptable visual systems","Direct fan relationships","Configurable business controls"].map(x=><p key={x}><Check size={17}/>{x}</p>)}</div></div>
      </div>
    </section>

    <section className="themes shell"><div className="theme-copy"><span className="kicker">YOUR LOOK</span><h2>Distinct by design.</h2><p>Choose a visual foundation, then make it yours. Typography, color, navigation, cards and content grids adapt through reusable design tokens.</p><div className="theme-list"><span>Luxury</span><span>Dark</span><span>Minimal</span><span>Pink / Glam</span><span>Lifestyle</span></div></div><div className="theme-orbit"><Palette size={38}/><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div><b>YOUR<br/>BRAND</b></div></section>

    <section className="pricing shell" id="pricing">
      <div className="center"><span className="kicker">SIMPLE PRICING</span><h2>Built for every stage of growth.</h2><p>Start with the tools you need and expand as your creator business grows.</p></div>
      <div className="price-grid">{plans.map(plan=><article className={plan.featured?"featured":""} key={plan.name}>{plan.featured&&<span className="popular">MOST POPULAR</span>}<h3>{plan.name}</h3><div className="price">{plan.price}<small>/month</small></div><p>{plan.note}</p><ul>{plan.features.map(x=><li key={x}><Check size={16}/>{x}</li>)}</ul><a href="#top">Get started <ArrowRight size={17}/></a></article>)}</div>
    </section>

    <section className="security" id="security"><div className="shell security-inner"><div><span className="kicker">SECURITY & CONTROL</span><h2>Your brand is yours.<br/>Your data stays separated.</h2></div><div className="security-points"><p><ShieldCheck/>Server-enforced tenant isolation</p><p><LockKeyhole/>Protected media access</p><p><Globe2/>Verified domain routing</p><p><Users/>Audited roles and permissions</p></div></div></section>

    <section className="steps shell"><span className="kicker">HOW IT WORKS</span><h2>From creator to live site.</h2><div>{[["01","Choose your plan"],["02","Shape your brand"],["03","Connect your domain"],["04","Publish and launch"]].map(([n,t])=><article key={n}><span>{n}</span><h3>{t}</h3></article>)}</div></section>

    <section className="closing shell"><span className="kicker">BUILD ON YOUR OWN NAME</span><h2>Your audience already follows you.<br/>Give them a place that feels like you.</h2><a className="primary" href="#pricing">Start your creator site <ArrowRight size={18}/></a></section>
    <footer className="shell"><a className="brand" href="#top"><span className="brand-mark">R</span>REDLIGHT</a><p>Independent creator infrastructure.</p><p>© 2026 Redlight</p></footer>
  </main>;
}
