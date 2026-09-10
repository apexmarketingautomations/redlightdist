# 90% completion pass

Paywall/provider choice is intentionally deferred. No fan-payment processor is made mandatory by this pass.

## Target
Raise every product area that does not require a provider/account/legal decision to >=90% implementation depth.

## Completion order
1. CRM: fan detail, tags, notes, saved/system segments, consent and acquisition context.
2. Campaigns: segments, scheduling, durable delivery, delivery status and metrics.
3. Automation: activation/pause, structured triggers/conditions/actions, scheduled execution, run history/retry.
4. Analytics: daily rollups, date ranges, LTV/churn/conversion/source/content metrics and creator dashboards.
5. Content: scheduling, archive/unarchive, media attachment and content lifecycle management.
6. Membership/fan account lifecycle: cancellation/renewal intent and billing-state visibility independent of processor choice.
7. Referrals/affiliates: codes, attribution, commissions/reward ledger and settlement states without selecting payout rail.
8. Compliance/admin operations: case assignment/status, emergency content removal, audit trail and restoration workflow.
9. Livestream: recording/replay lifecycle, offers/polls/gifting/guest state where provider-independent; provider-specific Egress remains configuration-gated.
10. Domains: verification/primary/redirect UX and provisioning adapter boundary; automatic SSL remains provider-gated.
11. SaaS billing: checkout/portal/upgrade/downgrade UX using the already separate platform-billing adapter.
12. Quality: expand security/integration/E2E coverage, load-test harness, backup/restore runbook, operational alerts.

## Deferred decisions
- Creator-to-fan paywall processor selection/merchant approval.
- Jurisdiction-specific legal rules.
- Production email/SMS/storage/live/domain credentials.
- AI provider selection; AI assistance remains adapter-driven rather than hardwired.

## Release rule
Do not merge this completion pass until lint, TypeScript, unit tests, migration tests, production build and tenant-isolation tests pass. Browser E2E against staging is required before calling the product launch-ready.
