export type Money = Readonly<{ amountMinor: number; currency: string }>;
export type ProviderContext = Readonly<{ creatorId: string; accountId: string; merchantReference?: string | null }>;

export interface PaymentCustomerInput {
  externalReference: string;
  email: string;
  name?: string;
}
export interface SubscriptionInput {
  customerId: string;
  externalReference: string;
  amount: Money;
  interval: "monthly" | "annual";
  description: string;
  returnUrl?: string;
}
export interface PurchaseInput {
  customerId: string;
  externalReference: string;
  amount: Money;
  description: string;
  returnUrl?: string;
}
export interface TipInput extends PurchaseInput {}
export interface RefundInput {
  transactionId: string;
  amount?: Money;
  externalReference: string;
}
export interface ProviderResult {
  id: string;
  status: "pending" | "active" | "settled" | "failed" | "cancelled" | "refunded";
  checkoutUrl?: string;
  rawReference?: string;
}
export interface ProviderWebhookResult {
  eventId: string;
  eventType: string;
  verified: boolean;
  creatorReference?: string;
  transactionReference?: string;
  payload: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createCustomer(context: ProviderContext, input: PaymentCustomerInput): Promise<ProviderResult>;
  createSubscription(context: ProviderContext, input: SubscriptionInput): Promise<ProviderResult>;
  cancelSubscription(context: ProviderContext, providerSubscriptionId: string): Promise<ProviderResult>;
  createPurchase(context: ProviderContext, input: PurchaseInput): Promise<ProviderResult>;
  createTip(context: ProviderContext, input: TipInput): Promise<ProviderResult>;
  refundTransaction(context: ProviderContext, input: RefundInput): Promise<ProviderResult>;
  getTransaction(context: ProviderContext, providerTransactionId: string): Promise<ProviderResult>;
  processWebhook(input: {headers: Headers; rawBody: string; secret?: string}): Promise<ProviderWebhookResult>;
}

export class PaymentProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} payment provider is not configured for this creator.`);
    this.name = "PaymentProviderNotConfiguredError";
  }
}

const registry = new Map<string, PaymentProvider>();
export function registerPaymentProvider(provider: PaymentProvider): void { registry.set(provider.name, provider); }
export function getPaymentProvider(name: string): PaymentProvider {
  const provider = registry.get(name);
  if (!provider) throw new PaymentProviderNotConfiguredError(name);
  return provider;
}
