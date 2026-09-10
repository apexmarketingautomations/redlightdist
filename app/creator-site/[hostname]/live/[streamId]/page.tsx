import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { LivePlayer } from "@/app/components/live-player";
import { normalizeHostname } from "@/src/modules/tenants/hostname";
import { resolveCreatorIdForHost } from "@/src/modules/tenants/server";
import { withCreator } from "@/src/server/db/scoped";
import { getCurrentFan } from "@/src/modules/auth/fan-session";
import { canFanAccessStream } from "@/src/server/live/access";

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    minor / 100,
  );

export default async function PublicLivePage({
  params,
}: {
  params: Promise<{ hostname: string; streamId: string }>;
}) {
  const { hostname, streamId } = await params;
  if (!z.string().uuid().safeParse(streamId).success) notFound();
  const actual = normalizeHostname((await headers()).get("host") ?? "");
  const requested = normalizeHostname(decodeURIComponent(hostname));
  if (!actual || actual !== requested) notFound();
  const creatorId = await resolveCreatorIdForHost(actual);
  if (!creatorId) notFound();
  const fan = await getCurrentFan();
  const data = await withCreator(creatorId, async (client) => {
    const creator = (
      await client.query<{ name: string }>(
        "SELECT name FROM creators WHERE id=$1 AND status='active' AND deleted_at IS NULL",
        [creatorId],
      )
    ).rows[0];
    const stream = (
      await client.query<{
        id: string;
        title: string;
        description: string;
        status: string;
        access_type: string;
        chat_enabled: boolean;
        scheduled_for: Date | null;
        started_at: Date | null;
        ppv_price_minor: number | null;
        currency: string;
      }>(
        "SELECT id,title,description,status,access_type,chat_enabled,scheduled_for,started_at,ppv_price_minor,currency FROM live_streams WHERE creator_id=$1 AND id=$2",
        [creatorId, streamId],
      )
    ).rows[0];
    if (!creator || !stream) return null;
    const decision = await canFanAccessStream(client, {
      creatorId,
      streamId,
      fanId: fan?.creatorId === creatorId ? fan.id : null,
    });
    const product =
      stream.access_type === "ppv"
        ? (
            await client.query<{
              id: string;
              price_minor: number;
              currency: string;
            }>(
              "SELECT id,price_minor,currency FROM products WHERE creator_id=$1 AND product_type='livestream' AND metadata->>'streamId'=$2 AND active LIMIT 1",
              [creatorId, streamId],
            )
          ).rows[0]
        : null;
    return { creator, stream, decision, product };
  });
  if (!data) notFound();
  return (
    <main className="creator-site creator-live-page">
      <header className="creator-site-nav">
        <a className="creator-site-logo" href="/">
          {data.creator.name}
        </a>
        <nav>
          <a href="/fan/account">My account</a>
        </nav>
      </header>
      <section className="creator-live-hero">
        <small>
          {data.stream.status.toUpperCase()} ·{" "}
          {data.stream.access_type.toUpperCase()}
        </small>
        <h1>{data.stream.title}</h1>
        <p>{data.stream.description}</p>
        {data.stream.scheduled_for && data.stream.status !== "live" && (
          <p>Scheduled for {data.stream.scheduled_for.toLocaleString()}</p>
        )}
      </section>
      {data.stream.status === "live" && data.decision.allowed ? (
        <LivePlayer
          streamId={streamId}
          chatEnabled={data.stream.chat_enabled}
        />
      ) : (
        <section className="creator-live-gate">
          <h2>
            {data.stream.status === "live"
              ? "Access required"
              : "This stream is not live yet"}
          </h2>
          {data.stream.status === "live" &&
            data.stream.access_type === "ppv" &&
            data.product && (
              <form method="post" action="/api/commerce/purchase">
                <input type="hidden" name="productId" value={data.product.id} />
                <button className="creator-primary" type="submit">
                  Buy admission ·{" "}
                  {money(data.product.price_minor, data.product.currency)}
                </button>
              </form>
            )}
          {data.stream.status === "live" && !fan && (
            <a className="creator-secondary" href="/fan/login">
              Log in
            </a>
          )}
        </section>
      )}
    </main>
  );
}
