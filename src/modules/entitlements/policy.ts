export const features = [
  "posts", "subscriptions", "customDomains", "membershipTiers", "media", "basicAnalytics",
  "ppv", "tips", "bundles", "favorites", "discounts", "trials", "crm", "fanTags", "fanNotes",
  "advancedAnalytics", "referrals", "emailAutomation", "automation", "aiAssistance", "scheduledCampaigns",
  "sms", "advancedAffiliates", "customLandingPages", "managedWorkflows",
  "live", "liveChat", "liveReplay", "livePpv", "livePrivateTiers", "liveAdvancedModeration",
  "liveGifting", "liveOffers", "livePolls", "liveGuests", "liveAdvancedAnalytics", "liveAutomation",
] as const;

export const quotaFeatures = ["maxStorageBytes", "maxVideoBytes", "maxAdmins", "maxMembershipTiers"] as const;

export type Feature = (typeof features)[number];
export type QuotaFeature = (typeof quotaFeatures)[number];
export type Plan = "starter" | "pro" | "elite";
export type BillingStatus = "active" | "trialing" | "grace" | "past_due" | "suspended" | "cancelled";
export type CreatorStatus = "draft" | "active" | "suspended" | "deleted";

const starter = new Set<Feature>([
  "posts", "subscriptions", "customDomains", "membershipTiers", "media", "basicAnalytics",
]);
const pro = new Set<Feature>([
  ...starter,
  "ppv", "tips", "bundles", "favorites", "discounts", "trials", "crm", "fanTags", "fanNotes",
  "advancedAnalytics", "referrals", "emailAutomation", "live", "liveChat", "liveReplay",
]);
const elite = new Set<Feature>(features);
const grants: Record<Plan, ReadonlySet<Feature>> = { starter, pro, elite };

export const defaultQuotas: Readonly<Record<Plan, Readonly<Record<QuotaFeature, number>>>> = {
  starter: { maxStorageBytes: 50 * 1024 ** 3, maxVideoBytes: 1 * 1024 ** 3, maxAdmins: 2, maxMembershipTiers: 1 },
  pro: { maxStorageBytes: 200 * 1024 ** 3, maxVideoBytes: 5 * 1024 ** 3, maxAdmins: 5, maxMembershipTiers: 10 },
  elite: { maxStorageBytes: 500 * 1024 ** 3, maxVideoBytes: 10 * 1024 ** 3, maxAdmins: 20, maxMembershipTiers: 50 },
};

export function planIncludesFeature(plan:Plan,feature:Feature):boolean { return grants[plan].has(feature); }

export function billingAllowsAccess(input: {billingStatus: BillingStatus; graceEndsAt?: Date; now: Date}): boolean {
  return input.billingStatus === "active" || input.billingStatus === "trialing" ||
    (input.billingStatus === "grace" && !!input.graceEndsAt && input.graceEndsAt > input.now);
}

// Inputs must come from trusted, tenant-scoped server records, never client claims.
export function canUseFeature(input: {
  plan: Plan;
  billingStatus: BillingStatus;
  creatorStatus: CreatorStatus;
  feature: Feature;
  graceEndsAt?: Date;
  now: Date;
  overrides?: Partial<Record<Feature, boolean>>;
}): boolean {
  if (input.creatorStatus !== "active" || !billingAllowsAccess(input)) return false;
  return input.overrides?.[input.feature] ?? planIncludesFeature(input.plan,input.feature);
}

export function quotaFor(input: {
  plan: Plan;
  quota: QuotaFeature;
  override?: number | null;
}): number {
  if (input.override !== undefined && input.override !== null) return Math.max(0, input.override);
  return defaultQuotas[input.plan][input.quota];
}

export function assertFeature(input: Parameters<typeof canUseFeature>[0]): void {
  if (!canUseFeature(input)) throw new Error(`FEATURE_NOT_AVAILABLE:${input.feature}`);
}

export const monthlyPriceMinor: Readonly<Record<Plan, number>> = {
  starter: 14900,
  pro: 29900,
  elite: 59900,
};
