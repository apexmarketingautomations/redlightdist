import "server-only";
import { requirePlatformAdmin } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
import type { AuthenticatedUser } from "@/src/modules/auth/session";
import type { PoolClient } from "pg";

export async function withPlatformAdmin<T>(
  operation: (client: PoolClient, user: AuthenticatedUser) => Promise<T>,
) {
  const user = await requirePlatformAdmin();
  return withUser(user.id, async (client) => {
    const check = await client.query(
      "SELECT id FROM platform_users WHERE id=$1 AND is_platform_admin AND disabled_at IS NULL FOR SHARE",
      [user.id],
    );
    if (!check.rowCount) throw new Error("Administrator access required.");
    await client.query("SELECT set_config('app.platform_admin','true',true)");
    return operation(client, user);
  });
}

export async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  creatorId: string | null = null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,creator_id,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [
      actorId,
      action,
      targetType,
      targetId,
      creatorId,
      JSON.stringify(metadata),
    ],
  );
}
