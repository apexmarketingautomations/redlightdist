import "server-only";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser, type AuthenticatedUser } from "@/src/modules/auth/session";
import { withCreatorUser, withUser } from "@/src/server/db/scoped";
import type { PoolClient } from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requirePlatformAdmin(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isPlatformAdmin) redirect("/dashboard");
  return user;
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function withAuthorizedCreator<T>(
  creatorId: string,
  operation: (client: PoolClient, user: AuthenticatedUser, role: string) => Promise<T>,
) {
  const user = await requireAuthenticatedUser();
  if (!UUID.test(creatorId)) notFound();

  if (user.isPlatformAdmin) {
    return withUser(user.id, async client => {
      const check = await client.query(
        "SELECT id FROM platform_users WHERE id=$1 AND is_platform_admin AND disabled_at IS NULL FOR SHARE",
        [user.id],
      );
      if (!check.rowCount) notFound();
      await client.query("SELECT set_config('app.platform_admin','true',true)");
      await client.query("SELECT set_config('app.creator_id',$1,true)", [creatorId]);
      const creator = await client.query("SELECT id FROM creators WHERE id=$1 AND deleted_at IS NULL LIMIT 1", [creatorId]);
      if (!creator.rowCount) notFound();
      return operation(client, user, "platform_admin");
    });
  }

  try {
    return await withCreatorUser(user.id, creatorId, (client, role) => operation(client, user, role));
  } catch (error) {
    if (error instanceof Error && ["CREATOR_ACCESS_DENIED", "Invalid identifier"].includes(error.message)) notFound();
    throw error;
  }
}
