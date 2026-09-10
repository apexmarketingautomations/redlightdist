import { hash, verify } from "@node-rs/argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, hashSessionToken } from "@/src/modules/auth/session";
import { db } from "@/src/server/db/pool";

export const runtime = "nodejs";

const credentialsSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(1024),
});

function safeEqual(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = (forwardedHost || request.headers.get("host") || "").toLowerCase();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });

  const { email, password } = parsed.data;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let user = (
      await client.query<{ id: string; password_hash: string; is_platform_admin: boolean; disabled_at: Date | null }>(
        "SELECT id, password_hash, is_platform_admin, disabled_at FROM platform_users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE",
        [email],
      )
    ).rows[0];

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    const matchesConfiguredAdmin =
      Boolean(adminEmail && adminPassword) &&
      safeEqual(email, adminEmail!) &&
      safeEqual(password, adminPassword!);

    if (matchesConfiguredAdmin) {
      const passwordHash = await hash(password);
      user = (
        await client.query<{ id: string; password_hash: string; is_platform_admin: boolean; disabled_at: Date | null }>(
          `INSERT INTO platform_users (email, password_hash, email_verified_at, is_platform_admin)
           VALUES ($1, $2, now(), true)
           ON CONFLICT (lower(email)) DO UPDATE SET
             password_hash = excluded.password_hash,
             email_verified_at = COALESCE(platform_users.email_verified_at, now()),
             is_platform_admin = true,
             disabled_at = NULL,
             updated_at = now()
           RETURNING id, password_hash, is_platform_admin, disabled_at`,
          [email, passwordHash],
        )
      ).rows[0];
    } else if (!user || user.disabled_at || !(await verify(user.password_hash, password))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    if (!user) throw new Error("Failed to resolve authenticated user.");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query("DELETE FROM sessions WHERE expires_at <= now() OR revoked_at IS NOT NULL");
    await client.query(
      `DELETE FROM sessions WHERE id IN (
         SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET 9
       )`,
      [user.id],
    );
    await client.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4)",
      [user.id, hashSessionToken(token), expiresAt, request.headers.get("user-agent")?.slice(0, 512) ?? null],
    );
    await client.query("COMMIT");

    const response = NextResponse.json({ ok: true, destination: user.is_platform_admin ? "/admin" : "/dashboard" });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
    });
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Login failed", error);
    return NextResponse.json({ error: "Login is temporarily unavailable." }, { status: 500 });
  } finally {
    client.release();
  }
}
