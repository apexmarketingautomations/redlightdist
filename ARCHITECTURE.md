# Redlightdist architecture

## Assessment and existing-system map
The repository starts from a README and a Next.js/TypeScript toolchain, not a working creator application. The screenshot describes an earlier implementation that is not present in this checkout. No production feature or successful test is inferred from that handoff.

## Target
One modular monolith serves every creator. PostgreSQL owns persistent state; Next.js owns server-rendered interfaces and server endpoints; a worker processes durable jobs. Creator themes use tokens, never separate application copies.

## Database changes
Phase 1 introduces PlatformUser, Session, VerificationToken, Creator, CreatorUser, CreatorDomain, CreatorSettings, CreatorTheme, Plan, PlanFeature, CreatorPlan, FeatureOverride, AuditLog, ComplianceRecord and ConsentRecord. Tenant tables require creatorId. Composite foreign keys prevent cross-tenant references; forced RLS uses transaction-local tenant context and a non-owner, non-BYPASSRLS runtime role. Separate migration credentials are never used by request handlers.

Phase 2 adds Fan, FanProfile, MembershipTier, CreatorSubscription (fan membership), Subscription (platform billing), ContentPost, MediaAsset, ContentAccessRule, Purchase, Transaction, Tip and WebhookEvent. Commerce uses integer minor units and explicit currency, immutable ledger entries and provider-account-scoped idempotency keys. Platform billing and creator merchant accounts remain separate.

Phase 3 adds Coupon, Referral, Affiliate, CRMTag, FanTag, Campaign, AnalyticsEvent and Notification. Phase 4 adds Automation, AutomationTrigger, AutomationAction and managed-service assignments. Reporting adds Report and TakedownRequest. LiveStream, LiveAdmission, LiveParticipant, LiveModeration, LiveRecording, LiveChatMessage, LiveAnalyticsSample and LiveProviderEvent belong to creator tenants.

## Folder structure
`app/`: marketing, admin, creator dashboard, public creator routes and API adapters.
`src/modules/`: auth, tenants, entitlements, content, payments, platform-billing, live, crm, automation, analytics, compliance and notifications.
`src/server/db/`: schema, scoped transactions, migrations and runtime role checks.
`tests/`: unit, database integration and browser acceptance tests.
`scripts/`: provisioning, migration checks, bootstrap and operational tooling.

## Exact Phase 1 sequence
1. Establish architecture, status tracking and dependency baseline.
2. Add database schema, constraints, RLS, transactional migrations and migration tests.
3. Implement verified-email authentication, password hashing, secure sessions, reset flow, RBAC, CSRF and rate limiting.
4. Resolve exact verified domains; bind authenticated creator membership to resolved tenant. Unknown domains fail closed.
5. Centralize entitlements and quota enforcement on the server.
6. Build audited creator onboarding and lifecycle controls, then creator settings and overview using real records.
7. Add five token-based themes, subdomain profiles and SaaS pricing/marketing pages.
8. Test migrations, authentication, cross-tenant reads/writes, gates, lint, types, build and mobile flows before release.

## Live streaming
LiveStreamingProvider exposes createStream, startStream, endStream, getStreamStatus, createPlaybackToken, getViewerCount, getStreamAnalytics, createRecording and deleteRecording. LiveKit is a candidate adapter, not an approved adult-content provider. Provider acceptance must be confirmed. Authorization derives memberships and settled admission purchases from server records. Tokens cannot grant publishing to viewers. Revocation disconnects participants; token expiry alone does not terminate an established session. Chat moderation must not be bypassable through direct client data publishing. Provider webhooks are authenticated and idempotent. Recording output remains private and requires fresh authorization.

## Risks and release gates
- No runtime authentication, tenant isolation, payment processing or live delivery is implemented yet. The only database operation exposed by the deployment bootstrap is a constant SELECT 1 readiness probe. A restricted application role and migrations are required before adding application queries.
- Processor onboarding, identity/age verification, jurisdiction policies and provider acceptable-use approval require external configuration/review; no compliance guarantees are made.
- Private objects and streams must never have permanent public access URLs.
- Unverified domains and forwarded headers cannot select tenants.
- Refunds, chargebacks and cancellation must revoke corresponding rights.
- Jobs, uploads, quotas and live costs require atomic limits, retries and monitoring.
- Backups need restore tests; deployment success alone is not production readiness.
- Dependencies need current security review before exposure.

## Deployment
Dedicated Railway project: 5105c3de-760c-4a3f-9f16-c99bdc3cec93.
Production environment: 887e6301-d62f-4dd7-b948-92840689c8bd.
Project creation is confirmed; application service 3dc60d93-0b9b-4774-aefa-e716bee950ba is connected to GitHub main; deployment verification is in progress. PostgreSQL service 2990012d-5e5a-4313-9c88-075a7d82ae20 is running with persistent storage and private networking. Preserve Next.js/PostgreSQL rather than replacing the architecture with a static hosted demo.
