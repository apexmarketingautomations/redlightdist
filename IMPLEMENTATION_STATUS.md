# Implementation status

Updated September 10, 2026 from the `full-scope-platform` branch.

## DONE

- One Next.js/PostgreSQL modular monolith with hostname tenant resolution, creator-scoped transactions, forced RLS, tenant foreign keys, and centralized plan entitlements/quotas.
- Platform/fan authentication, verification/reset, optional TOTP MFA, RBAC, secure cookies, rate limiting, session revocation, audit history, and audited support impersonation.
- Platform admin, creator onboarding/lifecycle/plan/feature controls, creator dashboard, five token-based themes, public creator sites, age gate, legal/reporting forms, fan accounts, memberships, purchases, favorites, and protected media authorization.
- Payment-provider contract and CCBill/Segpay adapters; creator SaaS billing remains a separate Stripe adapter.
- S3-compatible private storage with signed upload/download handling.
- Membership, PPV, tips, products, coupons, CRM, referrals, analytics, notifications, campaigns, durable automation, compliance, report/takedown, and emergency admin records/workflows.
- Livestream provider contract and LiveKit adapter, scheduled/public/subscriber/tier/PPV access, publisher/viewer credentials, chat, moderation, tips/admissions, recordings/replays, and analytics records.
- Railway application/PostgreSQL services, persistent database volume, health check, and pre-deploy migrations.
- Release-candidate verification after branch recovery: lint and TypeScript passed, 22 tests passed, migrations passed twice in an isolated PostgreSQL-compatible database, and the 31-page production build passed.

## IN PROGRESS

- Merge the repaired full-scope branch into `main`, deploy that exact commit to Railway, and verify deployment status, migrations, health response, and runtime logs.

## NOT STARTED

- No requested architectural module is absent. Provider-backed operations remain disabled until their production accounts are configured.

## BLOCKED

- Real creator/fan payments require approved CCBill or Segpay merchant accounts and credentials. Stripe is only for SaaS billing and is not assumed eligible for adult transactions.
- Real private media, email/SMS, MFA encryption, and livestream delivery require production provider credentials. Confirm LiveKit acceptable-use approval before enabling it for the intended vertical.
- Jurisdiction-specific age verification and adult-content rules require legal counsel review. The platform provides configurable enforcement records; it does not invent legal requirements.

## TECHNICAL DEBT

- Add browser coverage against a seeded staging environment; the current suite covers unit, restricted-role database, migration, type, lint, and production build behavior.
- Configure backups/restore drills, alert destinations, object lifecycle policies, and load tests before onboarding paying creators.
- Run dependency/security audits immediately before public launch and continuously thereafter.
