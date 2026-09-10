import { OfficeShell } from "@/app/components/office-shell";
import { ActionForm } from "@/app/components/action-form";
import { passwordAction } from "@/src/server/backoffice/actions";
import { requireAuthenticatedUser } from "@/src/modules/auth/authorization";
import { withUser } from "@/src/server/db/scoped";
export default async function Account() {
  const user=await requireAuthenticatedUser();
  const sessions=await withUser(user.id,async client=>(await client.query<{created_at:Date;expires_at:Date}>("SELECT created_at,expires_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 10",[user.id])).rows);
  return <OfficeShell admin={user.isPlatformAdmin} title="My account" description={user.email}><div className="office-columns"><section className="office-panel"><h2>Change password</h2><ActionForm action={passwordAction} label="Change password"><label>Current password<input name="current" type="password" required autoComplete="current-password"/></label><label>New password<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label>Confirm new password<input name="confirm" type="password" required autoComplete="new-password"/></label></ActionForm></section><section className="office-panel"><h2>Active sessions</h2><p>{sessions.length} active session{sessions.length===1?"":"s"}. Changing your password signs out other sessions.</p>{sessions.map((s,i)=><p key={i}>Signed in {s.created_at.toISOString().slice(0,10)} · Expires {s.expires_at.toISOString().slice(0,10)}</p>)}</section></div></OfficeShell>;
}
