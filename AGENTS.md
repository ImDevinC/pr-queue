# Project Agent Guide

## Overview

PR Queue is a small organization-level pull-request review queue. A single Node.js process receives GitHub and Slack webhooks, stores deliveries in PostgreSQL, processes them asynchronously, exposes the queue through Fastify, and serves a React/MUI dashboard in production.

Core stack: Node.js 22, strict TypeScript, native ESM, Fastify, React 19, Material UI, Vite, PostgreSQL, Zod, and Vitest.

## Repository Map

```text
src/server.ts             Application composition, HTTP routes, workers, shutdown
src/domain/queue.ts       Pure queue and status rules
src/github/               GitHub App API, webhook payload types, delivery processor
src/slack/                Slack API/signatures and message-event processor
src/db/storage.ts         PostgreSQL queries and persistence operations
src/db/{client,migrate}.ts Database connection and schema runner
src/config.ts             queue.yaml parsing and validation
src/env.ts                Environment parsing and validation
src/client/               React dashboard, theme, and browser entry point
db/schema.sql             Authoritative startup schema
config/queue.yaml         Organization, repository, and Slack allowlists
docs/                     GitHub and Slack app manifests
```

## Where To Start

| Change                       | Primary files                                    | Also inspect                                         |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Queue ordering or activation | `src/domain/queue.ts`                            | GitHub/Slack processors, storage, colocated tests    |
| GitHub event support         | `src/github/types.ts`, `src/github/processor.ts` | `src/github/api.ts`, `docs/github-app-manifest.json` |
| Slack link ingestion         | `src/slack/processor.ts`                         | `src/slack/api.ts`, `docs/slack-app-manifest.json`   |
| Database model or query      | `db/schema.sql`, `src/db/storage.ts`             | processors, `src/client/App.tsx`                     |
| HTTP route or startup        | `src/server.ts`                                  | environment, storage, production static serving      |
| Dashboard                    | `src/client/App.tsx`                             | `theme.ts`, `ThemeContext.tsx`, queue API shape      |
| Runtime configuration        | `src/config.ts`, `src/env.ts`                    | `.env.example`, `config/queue.yaml`, README          |

## Architecture Invariants

- PostgreSQL is the source of truth. Queue order, current PR state, and webhook retries must survive process restarts.
- Webhook routes verify signatures against the raw request body, persist an idempotent delivery/event record, and return promptly. Slow GitHub/Slack work belongs in the polling processors, not the request path.
- Workers claim one pending or failed record inside a transaction using `FOR UPDATE SKIP LOCKED`. Preserve this concurrency and retry model when changing delivery processing.
- Queue mutations that read and update ordering state must remain transactional. `organizations.queue_sequence` is the monotonic ordering source.
- Incoming GitHub data is filtered by configured organization and optional repository allowlist before it changes queue state.
- Status aggregates apply only to snapshots matching the PR's current head SHA. A new head resets aggregate statuses to `unknown`.
- Existing PRs are not imported at startup, and configuration changes do not backfill previously ignored PRs. Slack links are the explicit on-demand hydration path.
- The production Fastify process serves `dist/client`; development runs the backend and Vite separately.

## TypeScript Conventions

- This is native ESM with `moduleResolution: NodeNext`. Relative imports in `.ts` and `.tsx` source use `.js` extensions.
- Keep strict types at subsystem boundaries. Prefer explicit interfaces/types and `import type` for type-only dependencies.
- Validate untrusted configuration with Zod. Webhook payload contracts belong in `src/github/types.ts`; narrow unknown external data before use.
- Keep queue decisions pure where practical and test them independently from network and database code.
- Use async/await and injected dependencies through factory options, matching `createWebhookProcessor`, `createSlackProcessor`, and the API factories.
- SQL uses PostgreSQL syntax, snake_case identifiers, parameterized values, and explicit transactions. Never interpolate external values into SQL. The existing dynamic status column is selected only from a closed internal union.
- Frontend code uses functional components, hooks, MUI components, and `sx` styling. Preserve responsive behavior.
- The queue API contract is currently represented by `QueueRow` in `src/db/storage.ts` and mirrored in `src/client/App.tsx`. Update both when changing `/api/queue`.
- Formatting is Prettier 3 with repository defaults. There is no ESLint configuration or lint command.

## Database Changes

- `db/schema.sql` is source code, not generated output. `migrateDatabase` executes the whole file at startup.
- Existing schema statements are idempotent `CREATE ... IF NOT EXISTS`; this is not a versioned migration system. Adding a column or changing a constraint requires an explicit safe migration statement, not merely editing the original `CREATE TABLE` definition.
- Consider existing persisted PostgreSQL data. Do not assume a clean database or recommend `docker compose down -v` unless data deletion is intentional.
- Keep schema, storage queries, queue API output, and frontend types synchronized.

## Tests

- Vitest tests are colocated with source as `*.test.ts`.
- Use behavior-oriented `describe`/`it` names and explicit imports from `vitest`.
- Favor pure unit tests and real inputs. Existing configuration tests use real temporary files rather than mocked filesystem behavior.
- Add focused tests beside changed queue, parsing, or processor logic. Database, server, and frontend paths currently have limited direct coverage, so verify those changes deliberately.

Run focused tests while iterating:

```sh
npx vitest run src/path/to/file.test.ts
```

Run the full local verification before handoff when the change can affect compilation or packaging:

```sh
npm run typecheck
npm test
npm run build
```

GitHub PR workflows validate release metadata only; they do not run typechecking, tests, or builds. Local verification is therefore not optional.

## Common Commands

```sh
npm install              # Install/update dependencies and lockfile
npm run dev              # Fastify backend with tsx watch
npx vite                 # Frontend development server, run separately
npm run db:migrate       # Apply db/schema.sql to DATABASE_URL
npm run typecheck        # TypeScript without emit
npm test                 # Vitest once
npm run test:watch       # Vitest watch mode
npm run build            # Compile server, then build client into dist/client
npm run format           # Prettier-write the repository
docker compose up --build
```

## Do Not Edit

- `dist/` and `node_modules/` are generated and ignored.
- `.env` contains local secrets and is ignored. Update `.env.example` when adding required environment variables.
- Do not hand-edit `package-lock.json`; let npm maintain it.
- Treat URLs and identifiers in `config/queue.yaml` and `docs/*-manifest.json` as deployment configuration, not generic examples.

## Operational Notes

- The app requires GitHub and Slack credentials even when working on only one ingestion path because environment validation happens at startup.
- The server applies the schema on startup. Compose also runs the migration command before starting the server, so schema execution must remain idempotent.
- `repositories: []` means all repositories in the configured organization. `slack_channels: []` means all channels where the bot receives events.
- Pull requests remain queued after reviews. New commits and new review requests move active PRs to the back according to the documented deduplication rules.
- Pull requests require one of the repository's SemVer labels (`major`, `minor`, or `patch`) for the release-validation workflow.
