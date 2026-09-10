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

export async function POST(request: Request) {
  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    let user = (
      await client.query<{ id: string; password_hash: string; is_platform_admin: boolean }>(
        "SELECT id, password_hash, is_platform_admin FROM platform_users WHERE lower(email) = $1 LIMIT 1 FOR UPDATE",
        [email],
      )
    ).rows[0];

    if (!user) {
      const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword || !safeEqual(email, adminEmail) || !safeEqual(password, adminPassword)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }

      const passwordHash = await hash(password);
      user = (
        await client.query<{ id: string; password_hash: string; is_platform_admin: boolean }>(
          `INSERT INTO platform_users (email, password_hash, email_verified_at, is_platform_admin)
           VALUES ($1, $2, now(), true)
           ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now()
           RETURNING id, password_hash, is_platform_admin`,
          [email, passwordHash],
        )
      ).rows[0];
    } else if (!(await verify(user.password_hash, password))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    if (!user.is_platform_admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This account does not have admin access." }, { status: 403 });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await client.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, hashSessionToken(token), expiresAt],
    );
    await client.query("COMMIT");

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
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
