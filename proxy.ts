import { NextResponse, type NextRequest } from "next/server";

const reservedPrefixes=["/_next","/api","/admin","/dashboard","/account","/login","/health","/creator-site"];

export function proxy(request:NextRequest){
  const pathname=request.nextUrl.pathname;
  if(reservedPrefixes.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  const rawHost=request.headers.get("host")?.trim().toLowerCase()??"";
  const host=rawHost.replace(/:\d+$/,".").replace(/\.$/,"");
  const base=(process.env.PLATFORM_HOST||"redlightdist-production.up.railway.app").trim().toLowerCase().replace(/\.$/,"");
  if(!host||host==="localhost"||host===base||host===`www.${base}`) return NextResponse.next();
  const url=request.nextUrl.clone();
  const suffix=pathname==="/"?"":pathname;
  url.pathname=`/creator-site/${encodeURIComponent(host)}${suffix}`;
  return NextResponse.rewrite(url);
}

export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]};
