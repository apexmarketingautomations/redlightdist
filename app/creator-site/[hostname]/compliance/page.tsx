import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { normalizeHostname } from "@/src/modules/tenants/hostname";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { withCreator } from "@/src/server/db/scoped";

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ hostname: string }>;
}) {
  const { hostname } = await params;
  const actual = normalizeHostname((await headers()).get("host") ?? "");
  const requested = normalizeHostname(decodeURIComponent(hostname));
  if (!actual || actual !== requested) notFound();
  const creatorId = await resolveCreatorIdForHost(actual);
  if (!creatorId) notFound();
  const creator = await withCreator(
    creatorId,
    async (client) =>
      (
        await client.query<{ name: string }>(
          "SELECT name FROM creators WHERE id=$1 AND status='active' AND deleted_at IS NULL",
          [creatorId],
        )
      ).rows[0],
  );
  if (!creator) notFound();
  return (
    <main className="creator-site creator-legal">
      <section>
        <a href="/">← {creator.name}</a>
        <small>SAFETY & COMPLIANCE</small>
        <h1>Report a safety issue</h1>
        <p>
          This platform prohibits minors, non-consensual content, sexual
          exploitation, trafficking and illegal material. Reports are routed to
          the platform compliance workflow. Emergency situations should also be
          reported to the appropriate local authorities.
        </p>
        <form
          className="creator-form"
          method="post"
          action="/api/compliance/report"
        >
          <label>
            What are you reporting?
            <select name="subjectType" required>
              <option value="content">Content</option>
              <option value="livestream">Livestream</option>
              <option value="user">User</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Content, stream or account reference
            <input name="subjectId" required maxLength={255} />
          </label>
          <label>
            Reason
            <select name="reason" required>
              <option value="minor_safety">Minor safety concern</option>
              <option value="non_consent">Non-consensual content</option>
              <option value="exploitation">Sexual exploitation</option>
              <option value="trafficking">Trafficking concern</option>
              <option value="illegal_content">Illegal material</option>
              <option value="harassment">Harassment</option>
              <option value="copyright">Copyright</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Details
            <textarea name="description" rows={6} maxLength={5000} />
          </label>
          <button className="creator-primary" type="submit">
            Submit report
          </button>
        </form>
        <hr />
        <h2>Takedown / rights request</h2>
        <p>
          Use this form to submit a content-removal or rights request. This is
          an intake workflow, not a legal determination.
        </p>
        <form
          className="creator-form"
          method="post"
          action="/api/compliance/takedown"
        >
          <label>
            Your name
            <input name="name" required maxLength={200} />
          </label>
          <label>
            Email
            <input type="email" name="email" required maxLength={320} />
          </label>
          <label>
            Content reference
            <input name="contentReference" required maxLength={2000} />
          </label>
          <label>
            Basis for request
            <textarea
              name="basis"
              required
              minLength={20}
              maxLength={10000}
              rows={7}
            />
          </label>
          <button className="creator-primary" type="submit">
            Submit takedown request
          </button>
        </form>
      </section>
    </main>
  );
}
