# Redlight Creator Platform

One multi-tenant, white-label SaaS platform for independently branded creator subscription sites.

## Current state

Incomplete foundation: toolchain, domain-resolution and entitlement primitives with unit tests. There is no runnable application, database migration, authentication flow or livestream adapter yet. See IMPLEMENTATION_STATUS.md before using any planned configuration.

## Local checks

Requirements: Node.js 24+, pnpm 11+, PostgreSQL 16+.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

`DATABASE_URL` must use a non-superuser runtime role without `BYPASSRLS`. Use a separate owner URL in `DATABASE_ADMIN_URL` for migrations. See `ARCHITECTURE.md` and `IMPLEMENTATION_STATUS.md` for the design and honest delivery status.

## Planned release verification (not available yet)

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migration
pnpm build
```

## Livestreaming

Not implemented. LiveKit is the proposed initial adapter; credentials alone do not enable streaming. The design requires private recording storage and server-authorized playback. No provider approval or integration test has been completed.

This repository does not imply that any payment, hosting, or video provider permits every creator vertical. Provider approval and legal review remain deployment requirements.
