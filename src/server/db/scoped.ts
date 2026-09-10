import { db } from "@/src/server/db/pool";
import type { PoolClient } from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validId(value: string) {
  if (!UUID.test(value)) throw new Error("Invalid identifier");
}

async function transaction<T>(settings: Array<[string, string]>, operation: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Never execute tenant application queries as the privileged migration/owner role.
    await client.query("SET LOCAL ROLE redlight_runtime");
    for (const [key, value] of settings) await client.query("SELECT set_config($1,$2,true)", [key, value]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withUser<T>(userId: string, operation: (client: PoolClient) => Promise<T>) {
  validId(userId);
  return transaction([["app.user_id", userId]], operation);
}

export async function withCreator<T>(creatorId: string, operation: (client: PoolClient) => Promise<T>) {
  validId(creatorId);
  return transaction([["app.creator_id", creatorId]], operation);
}

export async function withCreatorUser<T>(
  userId: string,
  creatorId: string,
  operation: (client: PoolClient, role: string) => Promise<T>,
) {
  validId(userId);
  validId(creatorId);
  return transaction(
    [["app.user_id", userId], ["app.creator_id", creatorId]],
    async (client) => {
      const membership = await client.query<{ role: string }>(
        "SELECT cu.role::text FROM creator_users cu JOIN creators c ON c.id=cu.creator_id JOIN platform_users u ON u.id=cu.user_id WHERE cu.creator_id = $1 AND cu.user_id = $2 AND c.status IN ('draft','active') AND c.deleted_at IS NULL AND u.disabled_at IS NULL LIMIT 1",
        [creatorId, userId],
      );
      const role = membership.rows[0]?.role;
      if (!role) throw new Error("CREATOR_ACCESS_DENIED");
      return operation(client, role);
    },
  );
}
