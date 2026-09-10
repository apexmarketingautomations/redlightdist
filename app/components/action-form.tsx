"use client";
import { useActionState, type ReactNode } from "react";
export type FormState = { ok: boolean; message: string };
export type FormAction = (state: FormState, data: FormData) => Promise<FormState>;
export function ActionForm({ action, children, label = "Save changes", className = "" }: { action: FormAction; children: ReactNode; label?: string; className?: string }) {
  const [state, submit, pending] = useActionState(action, { ok: false, message: "" });
  return <form action={submit} className={`office-form ${className}`}>
    <fieldset disabled={pending}>{children}<button className="office-button" type="submit">{pending ? "Saving…" : label}</button></fieldset>
    {state.message && <p role="status" className={state.ok ? "form-success" : "form-error"}>{state.message}</p>}
  </form>;
}
