import { describe, expect, it } from "vitest";
import { canUseFeature, features } from "../src/modules/entitlements/policy";
import { normalizeHostname, resolveTenant } from "../src/modules/tenants/hostname";

const now = new Date("2026-09-10T00:00:00Z");
const base = { plan: "starter", billingStatus: "active", creatorStatus: "active", now } as const;
describe("entitlement policy", () => {
  it("excludes advanced capabilities from Starter", () => {
    for (const feature of features) {
      expect(canUseFeature({ ...base, feature })).toBe(["posts", "subscriptions", "customDomains"].includes(feature));
    }
  });
  it("separates Pro streaming from Elite paid events", () => {
    expect(canUseFeature({ ...base, plan: "pro", feature: "live" })).toBe(true);
    expect(canUseFeature({ ...base, plan: "pro", feature: "livePpv" })).toBe(false);
    expect(canUseFeature({ ...base, plan: "elite", feature: "livePpv" })).toBe(true);
  });
  it("cannot override suspension", () => {
    expect(canUseFeature({ ...base, creatorStatus: "suspended", feature: "live", overrides: { live: true } })).toBe(false);
    expect(canUseFeature({ ...base, billingStatus: "suspended", feature: "posts" })).toBe(false);
  });
  it("expires grace at the deadline and denies missing deadlines", () => {
    expect(canUseFeature({ ...base, billingStatus: "grace", feature: "posts" })).toBe(false);
    expect(canUseFeature({ ...base, billingStatus: "grace", graceEndsAt: now, feature: "posts" })).toBe(false);
    expect(canUseFeature({ ...base, billingStatus: "grace", graceEndsAt: new Date(now.getTime() + 1), feature: "posts" })).toBe(true);
  });
});
describe("hostname boundary", () => {
  it("normalizes DNS names and development ports", () => {
    expect(normalizeHostname("Creator.Example.com.:3000")).toBe("creator.example.com");
    expect(normalizeHostname("localhost:3000")).toBe("localhost");
  });
  it.each(["good.com@evil.com", "good.com/evil", "good.com,evil.com", " good.com", "-bad.com", "a..com", "a.com:65536", "a.com?x", "a.com\\evil"])("rejects ambiguous host %s", host => {
    expect(normalizeHostname(host)).toBeNull();
  });
  it("rejects unverified, suspended and mismatched domain records", async () => {
    const record = { hostname: "a.com", creatorId: "a", verified: true, creatorStatus: "active" } as const;
    expect(await resolveTenant("a.com", async () => record)).toBe("a");
    expect(await resolveTenant("b.com", async () => record)).toBeNull();
    expect(await resolveTenant("a.com", async () => ({ ...record, verified: false }))).toBeNull();
    expect(await resolveTenant("a.com", async () => ({ ...record, creatorStatus: "suspended" }))).toBeNull();
  });
});
