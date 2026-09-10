import "server-only";
import { redirect, notFound } from "next/navigation";
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
  try {
    return await withCreatorUser(user.id, creatorId, (client, role) => operation(client, user, role));
  } catch (error) {
    if (error instanceof Error && ["CREATOR_ACCESS_DENIED", "Invalid identifier"].includes(error.message)) notFound();
    throw error;
  }
}
