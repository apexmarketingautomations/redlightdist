import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processAutomationQueue } from "@/src/server/automation/service";
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function POST(request:Request){const expected=process.env.WORKER_SECRET,provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";if(!expected||!provided||!equal(provided,expected))return new NextResponse("Unauthorized",{status:401});const processed=await processAutomationQueue(20);return NextResponse.json({ok:true,processed});}
