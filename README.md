# Collaborative Movie Discovery & Watchlist

A movie discovery and watchlist app. Authenticated members browse and search films (sourced
from [TMDB](https://www.themoviedb.org/)), save titles privately, and build watchlists that
other members can collaborate on in real time — with per-list Owner / Editor / Viewer roles
and changes syncing live across everyone viewing the same list.

Built serverless on React 19 + TypeScript and AWS Amplify Gen 2. See [Tech stack](#tech-stack)
below for the full list.

## Documents (source of truth)

- [`docs/SRS.md`](docs/SRS.md) — what the system must do (requirement IDs: `FR-*`, `NFR-*`, `V-*`)
- [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) — how it's built (stack, module structure, ADRs)
- [`CLAUDE.md`](CLAUDE.md) — working rules distilled from the above, for AI-assisted development

If you're changing behavior, check the SRS/System Design first — they're the spec this app is
built against, and the rest of this README just summarizes them for a quick start.

## Getting started

Requires [pnpm](https://pnpm.io/) and AWS credentials for the sandbox backend.

```bash
pnpm install
pnpm sandbox        # starts a local Amplify backend sandbox (needs AWS credentials)
pnpm dev             # in a second terminal
```

You'll need a TMDB API key before `tmdb-proxy` works — get one from
<https://www.themoviedb.org/settings/api> and store it via
`npx ampx sandbox secret set TMDB_API_KEY` (SSM-backed — never put it in `.env`, see FR-TMDB-1).

## Scripts

| Command                | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `pnpm dev`             | Vite dev server                                                 |
| `pnpm sandbox`         | Local Amplify backend sandbox (needs AWS credentials)           |
| `pnpm build`           | Production build                                                |
| `pnpm build:analyze`   | Production build + bundle visualizer report (`dist/stats.html`) |
| `pnpm test`            | Unit/integration tests (Vitest)                                 |
| `pnpm test:e2e`        | End-to-end tests (Playwright)                                   |
| `pnpm lint`            | ESLint, including the Feature-Sliced Design boundaries check    |
| `pnpm format`          | Prettier write + ESLint fix                                     |
| `pnpm check`           | Prettier check only (no writes)                                 |
| `pnpm generate-routes` | Regenerate `src/routeTree.gen.ts` outside of dev/build          |

## Tech stack

React 19 + TypeScript (strict) on Vite, routed with TanStack Router and cached with TanStack
Query, styled with Tailwind CSS v4 over Base UI primitives. Forms run on react-hook-form + Zod.
The backend is AWS Amplify Gen 2 (Cognito auth, AppSync/DynamoDB data, a handful of Lambda
functions for the operations generated resolvers can't express). Full rationale for each
choice, including what was deliberately left out and why, is in
[`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) §2.1 and its ADRs.

## Project structure

Feature-Sliced Design: `app > pages > features > entities > shared`, each layer importing
only from layers strictly below it (enforced by `eslint-plugin-boundaries`, not convention).

```text
src/
  app/        providers, router (file-based routes), layouts, global styles
  pages/      discover, search, movie-detail, saved, watchlists, watchlist-detail, settings, auth
  features/   save-movie, manage-list-items, manage-members, toggle-watched,
              create-watchlist, filter-discovery, claim-username
  entities/   movie, watchlist, member (each with ui/ model/ api/)
  shared/     ui (Base UI wrappers), lib, config

amplify/
  auth/       Cognito user pool + triggers
  data/       schema, auth rules, custom operations
  functions/  post-confirmation, tmdb-proxy, membership, claim-username, permission-fanout
```

See [`CLAUDE.md`](CLAUDE.md) for the full naming and layering rules, including the one
framework-mandated exception (`src/app/router/`, where TanStack Router owns filenames).

## Status

This is a scaffold, still early:

- Folder structure follows Feature-Sliced Design (System Design §2.2). Only `app/` exists
  under `src/` so far — `pages/`, `features/`, `entities/`, `shared/` get created as each
  feature is built.
- `amplify/data/resource.ts` has the seven data models from §5.1 with **partial** auth
  rules — the field-level permission rules that satisfy FR-MEM-9/NFR-SEC-2 are stubbed as
  TODOs and must be implemented before this is safe to deploy publicly. Read the TODO
  comment on the `Watchlist` model before touching auth rules.
- `post-confirmation` is implemented (creates the `UserProfile` row on signup, FR-MEM-10)
  and wired as an auth trigger. The remaining four Lambdas in `amplify/functions/*/handler.ts`
  still have only a contract comment, no implementation.
- `tests/auth-matrix/watchlist-permissions.test.ts` encodes SRS §6.1's full authorization
  matrix as `it.todo(...)` — fill these in as you implement each permission path.
- No UI beyond the router scaffold exists yet — no auth screens, no pages, no components.

## Suggested build order

Roughly the order the System Design document itself argues for (auth model first, since
everything else's authorization depends on it existing):

1. `amplify/auth` + `post-confirmation` — registration, verification, UserProfile creation ✅
2. `claim-username` — atomic username claiming (FR-AUTH-3/4)
3. Discovery + `tmdb-proxy` — authenticated-only as of v1.1 (ADR-009), so this now depends on step 1
4. Saved films — simplest authenticated feature, good place to prove the TanStack Query + Amplify wiring
5. Watchlists (owner-only, no collaboration yet) — `create-watchlist`, `manage-list-items`
6. `membership` function + collaboration + the permission fan-out stream consumer
7. Real-time subscriptions on `/lists/:id` (System Design §2.4) — do this only after permissions are solid; the self-echo reconciliation logic assumes correct auth underneath it
8. Theme system, design tokens, attribution stripe — can happen in parallel with any of the above

## Constraints

Built to a six-week budget (System Design C-5). The "Known Limitations" (§9) and "Out of
Scope" (SRS §7) sections exist because of it — check those two lists before adding scope.
