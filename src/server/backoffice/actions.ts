"use server";
import { hash, verify } from "@node-rs/argon2";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withPlatformAdmin, audit } from "./access";
import { requireAuthenticatedUser, requirePlatformAdmin, withAuthorizedCreator } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
import { cookies } from "next/headers";
import { SESSION_COOKIE, hashSessionToken } from "@/src/modules/auth/session";
import type { FormState } from "@/app/components/action-form";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const email = z.string().trim().toLowerCase().email().max(320);
const role = z.enum(["owner", "admin", "editor", "analyst", "support"]);
const schema = z.discriminatedUnion("operation", [
  z.object({operation:z.literal("create-user"), email, password:z.string().min(12).max(128)}),
  z.object({operation:z.literal("user-status"), userId:uuid, status:z.enum(["active","disabled"])}),
  z.object({operation:z.literal("user-role"), userId:uuid, role:z.enum(["client","admin"])}),
  z.object({operation:z.literal("create-client"), name, slug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63), ownerEmail:email}),
  z.object({operation:z.literal("client-status"), creatorId:uuid, status:z.enum(["draft","active","suspended"])}),
  z.object({operation:z.literal("membership"), creatorId:uuid, email, role}),
  z.object({operation:z.literal("remove-member"), creatorId:uuid, userId:uuid}),
]);
function failure(error: unknown): FormState {
  const code = (error as {code?:string}).code;
  if (code === "23505") return {ok:false,message:"That email or workspace address already exists."};
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Please ")) return {ok:false,message};
  console.error("Back office operation failed", {code, message});
  return {ok:false,message:"The change could not be saved. Refresh and try again."};
}
export async function adminAction(_state: FormState, form: FormData): Promise<FormState> {
  // Authenticate before parsing or exposing any administrative operation.
  await requirePlatformAdmin();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return {ok:false,message:"Check the fields. Passwords need at least 12 characters; workspace addresses use lowercase letters, numbers, and hyphens."};
  const data = parsed.data;
  try {
    await withPlatformAdmin(async (client, actor) => {
      // Serialize role/lifecycle edits, including last-owner checks.
      await client.query("SELECT pg_advisory_xact_lock(7613401)");
      if (data.operation === "create-user") {
        const result = await client.query<{id:string}>("INSERT INTO platform_users(email,password_hash) VALUES($1,$2) RETURNING id", [data.email,await hash(data.password)]);
        await audit(client,actor.id,"user.created","user",result.rows[0]!.id);
      } else if (data.operation === "user-status" || data.operation === "user-role") {
        const target = (await client.query<{email:string;is_platform_admin:boolean}>("SELECT email,is_platform_admin FROM platform_users WHERE id=$1 FOR UPDATE",[data.userId])).rows[0];
        if (!target) throw new Error("Please select an existing user.");
        if (data.userId === actor.id || target.email.toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase()) throw new Error("Please keep your own account and the configured recovery administrator active and unchanged.");
        if (data.operation === "user-status") {
          if (target.is_platform_admin && data.status === "disabled") throw new Error("Please change this user's platform role to client before disabling them.");
          await client.query("UPDATE platform_users SET disabled_at=CASE WHEN $2='disabled' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1",[data.userId,data.status]);
        } else await client.query("UPDATE platform_users SET is_platform_admin=$2,updated_at=now() WHERE id=$1",[data.userId,data.role === "admin"]);
        await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[data.userId]);
        await audit(client,actor.id,data.operation === "user-status" ? `user.${data.status}` : `user.role.${data.role}`,"user",data.userId);
      } else if (data.operation === "create-client") {
        const owner = (await client.query<{id:string}>("SELECT id FROM platform_users WHERE lower(email)=$1 AND disabled_at IS NULL",[data.ownerEmail])).rows[0];
        if (!owner) throw new Error("Please create an active user for the owner email first.");
        const creator = (await client.query<{id:string}>("INSERT INTO creators(name,slug) VALUES($1,$2) RETURNING id",[data.name,data.slug])).rows[0]!;
        await client.query("INSERT INTO creator_users(creator_id,user_id,role) VALUES($1,$2,'owner')",[creator.id,owner.id]);
        await client.query("INSERT INTO creator_settings(creator_id) VALUES($1)",[creator.id]);
        await audit(client,actor.id,"client.created","creator",creator.id,creator.id);
      } else {
        const creator = await client.query("SELECT id FROM creators WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[data.creatorId]);
        if (!creator.rowCount) throw new Error("Please select an existing workspace.");
        if (data.operation === "client-status") {
          await client.query("UPDATE creators SET status=$2::creator_status,suspended_at=CASE WHEN $2::text='suspended' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1",[data.creatorId,data.status]);
          await audit(client,actor.id,`client.${data.status}`,"creator",data.creatorId,data.creatorId);
        } else {
          const userId = data.operation === "remove-member" ? data.userId : (await client.query<{id:string}>("SELECT id FROM platform_users WHERE lower(email)=$1 AND disabled_at IS NULL",[data.email])).rows[0]?.id;
          if (!userId) throw new Error("Please create an active user with that email first.");
          const members = (await client.query<{user_id:string;role:string}>("SELECT user_id,role::text FROM creator_users WHERE creator_id=$1",[data.creatorId])).rows;
          const removingOwner = members.some(m=>m.user_id===userId && m.role==="owner") && (data.operation==="remove-member" || data.role!=="owner");
          if (removingOwner && members.filter(m=>m.role==="owner").length<=1) throw new Error("Please assign another owner before removing the last owner.");
          if (data.operation === "remove-member") await client.query("DELETE FROM creator_users WHERE creator_id=$1 AND user_id=$2",[data.creatorId,userId]);
          else await client.query("INSERT INTO creator_users(creator_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(creator_id,user_id) DO UPDATE SET role=excluded.role",[data.creatorId,userId,data.role]);
          await audit(client,actor.id,data.operation === "remove-member" ? "member.removed" : `member.role.${data.role}`,"user",userId,data.creatorId);
        }
      }
    });
  } catch (error) { return failure(error); }
  revalidatePath("/admin","layout"); revalidatePath("/dashboard","layout");
  return {ok:true,message:"Saved successfully."};
}

export async function settingsAction(_state: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({creatorId:uuid,name,bio:z.string().trim().max(2000)}).safeParse(Object.fromEntries(form));
  if (!parsed.success) return {ok:false,message:"Enter a workspace name and a bio of up to 2,000 characters."};
  const {creatorId,name:workspaceName,bio} = parsed.data;
  const operation = async (client: import("pg").PoolClient, actor: {id:string}) => {
    await client.query("UPDATE creators SET name=$2,updated_at=now() WHERE id=$1",[creatorId,workspaceName]);
    await client.query("INSERT INTO creator_settings(creator_id,bio) VALUES($1,$2) ON CONFLICT(creator_id) DO UPDATE SET bio=excluded.bio,updated_at=now()",[creatorId,bio]);
    await audit(client,actor.id,"workspace.settings.updated","creator",creatorId,creatorId);
  };
  // Administrative editing is an explicit, separately authorized path.
  if (form.get("admin") === "true") {
    await withPlatformAdmin(async (client, actor) => {
      const exists = await client.query("SELECT id FROM creators WHERE id=$1 AND deleted_at IS NULL",[creatorId]);
      if (!exists.rowCount) throw new Error("Workspace not found.");
      await operation(client,actor);
    });
  } else {
    await withAuthorizedCreator(creatorId,async(client,actor,role)=> {
      if (!["owner","admin"].includes(role)) throw new Error("Workspace owner or administrator required.");
      await operation(client,actor);
    });
  }
  revalidatePath("/dashboard","layout"); revalidatePath("/admin","layout");
  return {ok:true,message:"Workspace settings saved."};
}

export async function passwordAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAuthenticatedUser();
  const parsed = z.object({current:z.string().min(1).max(128),password:z.string().min(12).max(128),confirm:z.string()}).safeParse(Object.fromEntries(form));
  if (!parsed.success || parsed.data.password !== parsed.data.confirm) return {ok:false,message:"Use at least 12 characters and matching new passwords."};
  if (user.email.toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase()) return {ok:false,message:"This is the recovery administrator. Its password is managed by the platform's ADMIN_PASSWORD configuration."};
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return withUser(user.id,async client=> {
    const row = (await client.query<{password_hash:string}>("SELECT password_hash FROM platform_users WHERE id=$1 FOR UPDATE",[user.id])).rows[0];
    if (!row || !await verify(row.password_hash,parsed.data.current)) return {ok:false,message:"Current password is incorrect."};
    await client.query("UPDATE platform_users SET password_hash=$2,updated_at=now() WHERE id=$1",[user.id,await hash(parsed.data.password)]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash<>$2",[user.id,hashSessionToken(token ?? "")]);
    return {ok:true,message:"Password changed. Other sessions have been signed out."};
  });
}
