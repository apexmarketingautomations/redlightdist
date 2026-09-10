"use client";
import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, type RemoteTrack } from "livekit-client";

type Message = {
  id: string;
  fan_id: string | null;
  body: string;
  created_at: string;
};

export function LivePlayer({
  streamId,
  chatEnabled,
}: {
  streamId: string;
  chatEnabled: boolean;
}) {
  const mediaRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState("Connecting…");
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [chatError, setChatError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const room = new Room();
    roomRef.current = room;
    const mediaNode = mediaRef.current;
    const attach = (track: RemoteTrack) => {
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.className = "live-media-track";
      mediaNode?.appendChild(element);
    };
    const detach = (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
    };
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, detach);
    room.on(RoomEvent.Disconnected, () => setStatus("Stream ended"));
    void (async () => {
      try {
        const response = await fetch(`/api/live/${streamId}/token`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          token?: string;
          url?: string;
          error?: string;
        };
        if (!response.ok || !data.token || !data.url)
          throw new Error(data.error || "Unable to join");
        if (cancelled) return;
        await room.connect(data.url, data.token);
        setStatus("Live");
      } catch (error) {
        if (!cancelled)
          setStatus(
            error instanceof Error ? error.message : "Unable to join stream",
          );
      }
    })();
    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect();
      mediaNode?.replaceChildren();
    };
  }, [streamId]);
  useEffect(() => {
    if (!chatEnabled) return;
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/live/${streamId}/chat`, {
          cache: "no-store",
        });
        if (r.ok && !stopped) {
          const j = (await r.json()) as { messages: Message[] };
          setMessages(j.messages);
        }
      } catch {}
    };
    void load();
    const id = window.setInterval(load, 4000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [streamId, chatEnabled]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = body.trim();
    if (!value) return;
    setChatError("");
    const r = await fetch(`/api/live/${streamId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: value }),
    });
    if (r.ok) {
      setBody("");
      const rr = await fetch(`/api/live/${streamId}/chat`, {
        cache: "no-store",
      });
      if (rr.ok)
        setMessages(((await rr.json()) as { messages: Message[] }).messages);
    } else {
      const j = (await r.json().catch(() => ({ error: "chat_error" }))) as {
        error?: string;
      };
      setChatError(j.error || "Unable to send");
    }
  };
  return (
    <div className="live-experience">
      <section className="live-player">
        <div className="live-player-status">
          <span>{status}</span>
        </div>
        <div ref={mediaRef} className="live-media-stage" />
      </section>
      {chatEnabled && (
        <aside className="live-chat">
          <h2>Live chat</h2>
          <div className="live-chat-feed">
            {messages.map((m) => (
              <p key={m.id}>
                <span>{m.fan_id ? "Fan" : "Guest"}</span>
                {m.body}
              </p>
            ))}
          </div>
          <form onSubmit={send}>
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              placeholder="Say something…"
            />
            <button type="submit">Send</button>
          </form>
          {chatError && <small>{chatError}</small>}
        </aside>
      )}
    </div>
  );
}
