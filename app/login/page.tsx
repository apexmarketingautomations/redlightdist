"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string; destination?: string };
    if (!response.ok) {
      setError(body.error ?? "Unable to log in.");
      setSubmitting(false);
      return;
    }

    router.replace(body.destination ?? "/dashboard");
    router.refresh();
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "radial-gradient(circle at top, #32101b, #0a090d 45%)" }}>
      <section style={{ width: "100%", maxWidth: 430, padding: "42px 36px", border: "1px solid #2a2732", background: "#121016", boxShadow: "0 30px 90px #000" }}>
        <a className="brand" href="/" style={{ marginBottom: 38 }}><span className="brand-mark">R</span>REDLIGHT</a>
        <span className="kicker">ADMIN ACCESS</span>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 42, fontWeight: 400, margin: "10px 0 8px" }}>Welcome back.</h1>
        <p style={{ color: "#a8a5b1", margin: "0 0 28px" }}>Sign in with the administrator credentials configured for this deployment.</p>
        <form onSubmit={submit}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required style={{ width: "100%", padding: 14, marginBottom: 18, color: "white", background: "#0a090d", border: "1px solid #3a3540", fontSize: 16 }} />
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }} htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required style={{ width: "100%", padding: 14, marginBottom: 18, color: "white", background: "#0a090d", border: "1px solid #3a3540", fontSize: 16 }} />
          {error && <p role="alert" style={{ color: "#ff7090", fontSize: 14 }}>{error}</p>}
          <button className="primary" type="submit" disabled={submitting} style={{ border: 0, width: "100%", cursor: submitting ? "wait" : "pointer", opacity: submitting ? .7 : 1 }}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
