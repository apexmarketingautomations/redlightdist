import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOperationalQueues } from "@/src/server/operations/worker";
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export async function POST(request:Request){const expected=process.env.WORKER_SECRET,provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";if(!expected||!provided||!equal(provided,expected))return new NextResponse("Unauthorized",{status:401});try{const result=await processOperationalQueues();return NextResponse.json({ok:true,...result});}catch(error){console.error("Operational worker failed",{message:error instanceof Error?error.message:"unknown"});return NextResponse.json({ok:false,error:"worker_failed"},{status:500});}}
