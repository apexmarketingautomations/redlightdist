import { normalizeHostname } from "./hostname";
import { withRuntime } from "@/src/server/db/scoped";

export function platformHost():string|null{
  return normalizeHostname(process.env.PLATFORM_HOST?.trim()||"redlightdist-production.up.railway.app");
}

export async function resolveCreatorIdForHost(rawHost:string):Promise<string|null>{
  const host=normalizeHostname(rawHost); const base=platformHost();
  if(!host||!base) return null;
  return withRuntime(async client=>{
    const row=(await client.query<{creator_id:string|null}>("SELECT resolve_creator_host($1,$2) AS creator_id",[host,base])).rows[0];
    return row?.creator_id??null;
  });
}
