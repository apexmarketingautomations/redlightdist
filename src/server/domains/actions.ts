"use server";
import { resolveTxt } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAuthorizedCreator } from "@/src/modules/auth/authorization";
import type { FormState } from "@/app/components/action-form";

const schema=z.object({creatorId:z.string().uuid(),domainId:z.string().uuid(),operation:z.enum(["verify","primary","redirect"])});
const roles=new Set(["owner","admin","platform_admin"]);
export async function domainAction(_state:FormState,form:FormData):Promise<FormState>{
  const parsed=schema.safeParse(Object.fromEntries(form));if(!parsed.success)return{ok:false,message:"Invalid domain request."};const d=parsed.data;
  try{
    await withAuthorizedCreator(d.creatorId,async(client,_user,role)=>{
      if(!roles.has(role))throw new Error("ROLE_DENIED");
      const domain=(await client.query<{id:string;hostname:string;status:string;is_primary:boolean;redirect_to_primary:boolean}>("SELECT id,hostname,status,is_primary,redirect_to_primary FROM creator_domains WHERE creator_id=$1 AND id=$2 FOR UPDATE",[d.creatorId,d.domainId])).rows[0];if(!domain)throw new Error("DOMAIN_NOT_FOUND");
      if(d.operation==="verify"){
        const expected=`redlight-domain-verification=${domain.id}`;let found=false;let reason="TXT record not found";
        try{const records=await resolveTxt(`_redlight.${domain.hostname}`);found=records.some(chunks=>chunks.join("").trim()===expected);if(!found)reason=`Expected TXT value ${expected}`;}catch(error){reason=error instanceof Error?error.message:"DNS lookup failed";}
        await client.query("UPDATE creator_domains SET status=$3::domain_status,verified_at=CASE WHEN $3='verified' THEN now() ELSE verified_at END,last_checked_at=now(),last_error=CASE WHEN $3='verified' THEN NULL ELSE $4 END,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.domainId,found?"verified":"failed",reason.slice(0,1000)]);
        if(!found)throw new Error("DOMAIN_UNVERIFIED");
      }else if(d.operation==="primary"){
        if(domain.status!=="verified")throw new Error("DOMAIN_UNVERIFIED");
        await client.query("UPDATE creator_domains SET is_primary=false,updated_at=now() WHERE creator_id=$1 AND is_primary",[d.creatorId]);
        await client.query("UPDATE creator_domains SET is_primary=true,redirect_to_primary=false,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.domainId]);
      }else{
        if(domain.is_primary)throw new Error("PRIMARY_CANNOT_REDIRECT");
        await client.query("UPDATE creator_domains SET redirect_to_primary=NOT redirect_to_primary,updated_at=now() WHERE creator_id=$1 AND id=$2",[d.creatorId,d.domainId]);
      }
    });
  }catch(error){const m=error instanceof Error?error.message:"";return{ok:false,message:m==="DOMAIN_UNVERIFIED"?"DNS verification did not pass yet. Check the TXT record and try again.":"Domain update could not be completed."};}
  revalidatePath(`/dashboard/${d.creatorId}/domain`);return{ok:true,message:"Domain updated."};
}
