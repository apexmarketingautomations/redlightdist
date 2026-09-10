import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const state = vi.hoisted(()=>({token:"admin-token",query: null as unknown as (sql:string,params?:unknown[])=>Promise<unknown>}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>state.token?{value:state.token}:undefined})}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`);},notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/src/server/db/pool",()=>({db:{query:(sql:string,params?:unknown[])=>state.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>state.query(sql,params),release:()=>{}})}}));
import { hashSessionToken, getCurrentUser } from "../src/modules/auth/session";
import { adminAction, settingsAction } from "../src/server/backoffice/actions";
import { withCreatorUser } from "../src/server/db/scoped";
import { withPlatformAdmin } from "../src/server/backoffice/access";

const db=new PGlite();
const admin="11111111-1111-4111-8111-111111111111";
const a="22222222-2222-4222-8222-222222222222";
const b="33333333-3333-4333-8333-333333333333";
const ca="44444444-4444-4444-8444-444444444444";
const cb="55555555-5555-4555-8555-555555555555";
const initial={ok:false,message:""};
function form(values:Record<string,string>){const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,v);return f;}
beforeAll(async()=>{
  for(const name of ["0001_foundation.sql","0002_security_hardening.sql","0003_backoffice.sql"])await db.exec((await readFile(`migrations/${name}`,"utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;",""));
  for(const [id,email,isAdmin,token] of [[admin,"admin@example.test",true,"admin-token"],[a,"a@example.test",false,"a-token"],[b,"b@example.test",false,"b-token"]] as const){
    await db.query("INSERT INTO platform_users(id,email,password_hash,is_platform_admin) VALUES($1,$2,'unused',$3)",[id,email,isAdmin]);
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",[id,hashSessionToken(token)]);
  }
  await db.query("INSERT INTO creators(id,name,slug,status) VALUES($1,'A','a','active'),($2,'B','b','active')",[ca,cb]);
  await db.query("INSERT INTO creator_users(creator_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner')",[ca,a,cb,b]);
  await db.query("INSERT INTO creator_settings(creator_id,bio) VALUES($1,'A private'),($2,'B private')",[ca,cb]);
  await db.exec("CREATE ROLE runtime_user; GRANT USAGE ON SCHEMA public TO runtime_user; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO runtime_user; SET ROLE runtime_user;");
  state.query=async(sql,params)=>{
    // PGlite does not provide advisory locking; production PostgreSQL executes this lock.
    if(sql.includes("pg_advisory_xact_lock"))return {rows:[],rowCount:1};
    const result=await db.query(sql,params); return {...result,rowCount:result.rows.length || result.affectedRows || 0};
  };
},30000);
afterAll(async()=>{await db.close();});
describe("back office authorization with real SQL and a restricted database role",()=>{
  it("gives platform administrators audited client management without client membership",async()=>{
    state.token="admin-token";
    const rows=await withPlatformAdmin(async client=>(await client.query("SELECT creator_id,bio FROM creator_settings ORDER BY creator_id")).rows);
    expect(rows).toHaveLength(2);
    const result=await settingsAction(initial,form({admin:"true",creatorId:cb,name:"B managed",bio:"Updated by platform admin"}));
    expect(result.ok).toBe(true);
    expect((await withPlatformAdmin(async client=>(await client.query("SELECT action FROM audit_logs WHERE creator_id=$1",[cb])).rows))[0]?.action).toBe("workspace.settings.updated");
  });
  it("prevents clients from selecting administrator access",async()=>{
    state.token="a-token";
    await expect(settingsAction(initial,form({admin:"true",creatorId:cb,name:"Stolen",bio:"No"}))).rejects.toThrow("REDIRECT:/dashboard");
    await expect(adminAction(initial,form({operation:"user-role",userId:a,role:"admin"}))).rejects.toThrow("REDIRECT:/dashboard");
  });
  it("allows own workspace access and rejects cross-tenant reads and writes",async()=>{
    state.token="a-token";
    const rows=await withCreatorUser(a,ca,async client=>(await client.query("SELECT bio FROM creator_settings")).rows);
    expect(rows).toEqual([{bio:"A private"}]);
    await expect(withCreatorUser(a,cb,async client=>client.query("SELECT bio FROM creator_settings"))).rejects.toThrow("CREATOR_ACCESS_DENIED");
    await expect(settingsAction(initial,form({creatorId:cb,name:"Stolen",bio:"No"}))).rejects.toThrow("NOT_FOUND");
    expect((await settingsAction(initial,form({creatorId:ca,name:"A updated",bio:"Own update"}))).ok).toBe(true);
  });
  it("denies settings writes to a read-only workspace role",async()=>{
    state.token="admin-token";
    expect((await adminAction(initial,form({operation:"membership",creatorId:ca,email:"b@example.test",role:"analyst"}))).ok).toBe(true);
    state.token="b-token";
    await expect(settingsAction(initial,form({creatorId:ca,name:"Unauthorized",bio:"No"}))).rejects.toThrow("Workspace owner or administrator required");
  });
  it("creates users and workspaces, and protects the last workspace owner",async()=>{
    state.token="admin-token";
    expect((await adminAction(initial,form({operation:"create-user",email:"new@example.test",password:"Test-only-password-42!"}))).ok).toBe(true);
    expect((await adminAction(initial,form({operation:"create-client",name:"New Client",slug:"new-client",ownerEmail:"new@example.test"}))).ok).toBe(true);
    expect((await adminAction(initial,form({operation:"remove-member",creatorId:ca,userId:a}))).message).toContain("another owner");
  });
  it("blocks suspended workspaces and disabled sessions",async()=>{
    state.token="admin-token";
    expect((await adminAction(initial,form({operation:"client-status",creatorId:ca,status:"suspended"}))).ok).toBe(true);
    await expect(withCreatorUser(a,ca,async()=>true)).rejects.toThrow("CREATOR_ACCESS_DENIED");
    expect((await adminAction(initial,form({operation:"user-status",userId:b,status:"disabled"}))).ok).toBe(true);
    state.token="b-token";
    expect(await getCurrentUser()).toBeNull();
  });
  it("clears admin transaction context before a client operation",async()=>{
    state.token="admin-token";
    await withPlatformAdmin(async client=>client.query("SELECT 1"));
    const result=await db.query("SELECT current_setting('app.platform_admin',true) AS admin,current_setting('app.creator_id',true) AS tenant");
    expect(result.rows[0]).toEqual({admin:"",tenant:""});
    expect((await db.query("SELECT * FROM creator_settings")).rows).toHaveLength(0);
  });
});
