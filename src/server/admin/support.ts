"use server";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withPlatformAdmin, audit } from "@/src/server/backoffice/access";
import type { FormState } from "@/app/components/action-form";

const SUPPORT_COOKIE = "redlight_support_session";
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function startSupportSession(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = z
    .object({
      creatorId: z.string().uuid(),
      reason: z.string().trim().min(3).max(1000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Enter a support reason." };
  const token = randomBytes(32).toString("base64url");
  try {
    await withPlatformAdmin(async (client, actor) => {
      const exists = await client.query(
        "SELECT 1 FROM creators WHERE id=$1 AND deleted_at IS NULL",
        [parsed.data.creatorId],
      );
      if (!exists.rowCount) throw new Error("CREATOR_NOT_FOUND");
      await client.query(
        "UPDATE admin_support_sessions SET ended_at=now() WHERE actor_user_id=$1 AND ended_at IS NULL",
        [actor.id],
      );
      await client.query(
        "INSERT INTO admin_support_sessions(creator_id,actor_user_id,token_hash,reason,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
        [parsed.data.creatorId, actor.id, hash(token), parsed.data.reason],
      );
      await audit(
        client,
        actor.id,
        "support.impersonation.started",
        "creator",
        parsed.data.creatorId,
        parsed.data.creatorId,
      );
    });
    (await cookies()).set(SUPPORT_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 60,
    });
  } catch (error) {
    console.error("Support session start failed", {
      creatorId: parsed.data.creatorId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, message: "Support session could not be started." };
  }
  redirect(`/dashboard/${parsed.data.creatorId}`);
}

export async function endSupportSession() {
  const jar = await cookies();
  const token = jar.get(SUPPORT_COOKIE)?.value;
  if (token) {
    await withPlatformAdmin(async (client, actor) => {
      const session = (
        await client.query<{ id: string; creator_id: string }>(
          "SELECT id,creator_id FROM admin_support_sessions WHERE actor_user_id=$1 AND token_hash=$2 AND ended_at IS NULL FOR UPDATE",
          [actor.id, hash(token)],
        )
      ).rows[0];
      if (session) {
        await client.query(
          "UPDATE admin_support_sessions SET ended_at=now() WHERE id=$1",
          [session.id],
        );
        await audit(
          client,
          actor.id,
          "support.impersonation.ended",
          "creator",
          session.creator_id,
          session.creator_id,
        );
      }
    });
  }
  jar.set(SUPPORT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  redirect("/admin");
}

export async function getActiveSupportSession(creatorId: string) {
  const token = (await cookies()).get(SUPPORT_COOKIE)?.value;
  if (!token) return null;
  try {
    return await withPlatformAdmin(
      async (client, actor) =>
        (
          await client.query<{ reason: string; expires_at: Date }>(
            "SELECT reason,expires_at FROM admin_support_sessions WHERE creator_id=$1 AND actor_user_id=$2 AND token_hash=$3 AND ended_at IS NULL AND expires_at>now() LIMIT 1",
            [creatorId, actor.id, hash(token)],
          )
        ).rows[0] ?? null,
    );
  } catch {
    return null;
  }
}
