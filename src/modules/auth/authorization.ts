import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type AuthenticatedUser } from "@/src/modules/auth/session";
import { withCreatorUser } from "@/src/server/db/scoped";
import type { PoolClient } from "pg";

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
  return withCreatorUser(user.id, creatorId, (client, role) => operation(client, user, role));
}
