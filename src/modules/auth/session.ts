import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/src/server/db/pool";

export const SESSION_COOKIE = "redlight_session";

export type AuthenticatedUser = {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
};

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await db.query<{
    id: string;
    email: string;
    is_platform_admin: boolean;
  }>(
    `SELECT u.id, u.email, u.is_platform_admin
       FROM sessions s
       JOIN platform_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1`,
    [hashSessionToken(token)],
  );

  return result.rows[0]
    ? {
        id: result.rows[0].id,
        email: result.rows[0].email,
        isPlatformAdmin: result.rows[0].is_platform_admin,
      }
    : null;
}
