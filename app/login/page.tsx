"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage(){
  const router=useRouter();const [error,setError]=useState("");const [submitting,setSubmitting]=useState(false);const [mfaRequired,setMfaRequired]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSubmitting(true);setError("");const form=new FormData(event.currentTarget);
    const response=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:form.get("email"),password:form.get("password"),mfaCode:mfaRequired?form.get("mfaCode")||undefined:undefined})});
    const body=(await response.json().catch(()=>({}))) as {error?:string;destination?:string;mfaRequired?:boolean;verificationRequired?:boolean};
    if(!response.ok){if(body.mfaRequired)setMfaRequired(true);setError(body.error??"Unable to log in.");setSubmitting(false);return;}
    router.replace(body.destination??"/dashboard");router.refresh();
  }
  const input={width:"100%",padding:14,marginBottom:18,color:"white",background:"#0a090d",border:"1px solid #3a3540",fontSize:16} as const;
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"radial-gradient(circle at top, #32101b, #0a090d 45%)"}}><section style={{width:"100%",maxWidth:430,padding:"42px 36px",border:"1px solid #2a2732",background:"#121016",boxShadow:"0 30px 90px #000"}}><a className="brand" href="/" style={{marginBottom:38}}><span className="brand-mark">R</span>REDLIGHT</a><span className="kicker">PLATFORM ACCESS</span><h1 style={{fontFamily:"Georgia, serif",fontSize:42,fontWeight:400,margin:"10px 0 8px"}}>Welcome back.</h1><p style={{color:"#a8a5b1",margin:"0 0 28px"}}>Sign in to your creator or platform administrator account.</p><form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required style={input}/><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required style={input}/>{mfaRequired&&<><label htmlFor="mfaCode">Authenticator code</label><input id="mfaCode" name="mfaCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required style={input}/></>}{error&&<p role="alert" style={{color:"#ff7090",fontSize:14}}>{error}</p>}<button className="primary" type="submit" disabled={submitting} style={{border:0,width:"100%",cursor:submitting?"wait":"pointer",opacity:submitting?.7:1}}>{submitting?"Signing in…":"Sign in"}</button></form><div style={{display:"flex",justifyContent:"space-between",gap:16,marginTop:20,fontSize:13}}><a href="/forgot-password">Forgot password?</a><a href="/verify-email">Verify email</a></div></section></main>;
}
