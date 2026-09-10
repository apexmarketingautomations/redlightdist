import { domainToASCII } from "node:url";

/** Parse Host only. Forwarded headers require a separately configured trusted proxy. */
export function normalizeHostname(raw: string): string | null {
  if (!raw || raw !== raw.trim() || /[\s/@\\?#,%]/.test(raw)) return null;
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(raw);
  if (!match?.[1]) return null;
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return null;
  const hostname = domainToASCII(match[1].toLowerCase().replace(/\.$/, ""));
  if (!hostname || hostname.length > 253) return null;
  if (!hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return hostname;
}

export interface DomainRecord {
  hostname: string;
  creatorId: string;
  verified: boolean;
  creatorStatus: "draft" | "active" | "suspended" | "deleted";
}

/** Repository must perform an exact unique hostname lookup, not a suffix match. */
export async function resolveTenant(
  rawHost: string,
  findExactDomain: (hostname: string) => Promise<DomainRecord | null>,
): Promise<string | null> {
  const hostname = normalizeHostname(rawHost);
  if (!hostname) return null;
  const record = await findExactDomain(hostname);
  if (!record || record.hostname !== hostname || !record.verified || record.creatorStatus !== "active") return null;
  return record.creatorId;
}
