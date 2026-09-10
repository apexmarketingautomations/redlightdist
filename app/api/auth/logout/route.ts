import { NextResponse } from "next/server";
import { SESSION_COOKIE, hashSessionToken } from "@/src/modules/auth/session";
import { db } from "@/src/server/db/pool";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (token) {
    await db.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [
      hashSessionToken(decodeURIComponent(token)),
    ]).catch((error) => console.error("Session revocation failed", error));
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
