export const features = [
  "posts", "subscriptions", "customDomains", "ppv", "tips", "crm",
  "advancedAnalytics", "referrals", "emailAutomation", "automation", "sms",
  "advancedAffiliates", "live", "liveChat", "liveReplay", "livePpv",
  "livePrivateTiers", "liveAdvancedModeration", "liveGifting", "liveOffers",
  "livePolls", "liveGuests", "liveAdvancedAnalytics", "liveAutomation",
] as const;
export type Feature = (typeof features)[number];
export type Plan = "starter" | "pro" | "elite";
export type BillingStatus = "active" | "trialing" | "grace" | "past_due" | "suspended";
const starter: readonly Feature[] = ["posts", "subscriptions", "customDomains"];
const pro: readonly Feature[] = [...starter, "ppv", "tips", "crm", "advancedAnalytics", "referrals", "emailAutomation", "live", "liveChat", "liveReplay"];
const grants: Record<Plan, readonly Feature[]> = { starter, pro, elite: features };

// Inputs must come from trusted, tenant-scoped database records, never client claims.
export function canUseFeature(input: {
  plan: Plan;
  billingStatus: BillingStatus;
  creatorStatus: "draft" | "active" | "suspended" | "deleted";
  feature: Feature;
  graceEndsAt?: Date;
  now: Date;
  overrides?: Partial<Record<Feature, boolean>>;
}): boolean {
  if (input.creatorStatus !== "active") return false;
  const usableBilling = input.billingStatus === "active" || input.billingStatus === "trialing" ||
    (input.billingStatus === "grace" && !!input.graceEndsAt && input.graceEndsAt > input.now);
  if (!usableBilling) return false;
  return input.overrides?.[input.feature] ?? grants[input.plan]?.includes(input.feature) ?? false;
}

export const monthlyPriceMinor: Readonly<Record<Plan, number>> = {
  starter: 14900, pro: 29900, elite: 59900,
};
