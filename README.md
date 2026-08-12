# Collaborative Movie Discovery & Watchlist

Spec-first scaffold for a serverless React + Amplify Gen 2 app.

## Documents (source of truth)

- [`docs/SRS.md`](docs/SRS.md) — what the system must do (requirement IDs: `FR-*`, `NFR-*`, `V-*`)
- [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) — how it's built (stack, module structure, ADRs)
- [`CLAUDE.md`](CLAUDE.md) — working rules distilled from the above, for AI-assisted development

## Status

This is a scaffold, not a working app yet:

- Folder structure follows Feature-Sliced Design (System Design §2.2).
- `amplify/data/resource.ts` has the seven data models from §5.1 with **partial** auth rules — the field-level permission rules that satisfy FR-MEM-9/NFR-SEC-2 are stubbed as TODOs and must be implemented before this is safe to deploy. Read the TODO comment on the `Watchlist` model before touching auth rules.
- Each Lambda in `amplify/functions/*/handler.ts` has a detailed comment describing its contract and the requirement IDs it satisfies, but no implementation yet.
- `tests/auth-matrix/watchlist-permissions.test.ts` encodes SRS §6.1's full authorization matrix as `it.todo(...)` — fill these in as you implement each permission path.

## Getting started

```bash
pnpm install
pnpm sandbox        # starts a local Amplify backend sandbox (needs AWS credentials)
pnpm dev             # in a second terminal
```

You'll need a TMDB API key before `tmdb-proxy` will work — get one from <https://www.themoviedb.org/settings/api> and store it via `npx ampx sandbox secret set TMDB_API_KEY` (SSM-backed — never put it in `.env`, see FR-TMDB-1).

## Suggested build order

Roughly the order the System Design document itself argues for (auth model first, since everything else's authorization depends on it existing):

1. `amplify/auth` + `post-confirmation` — registration, verification, UserProfile creation
2. `claim-handle` — atomic handle claiming (FR-AUTH-3/4)
3. Discovery + `tmdb-proxy` — authenticated-only as of v1.1 (ADR-009), so this now depends on step 1
4. Saved films — simplest authenticated feature, good place to prove the TanStack Query + Amplify wiring
5. Watchlists (owner-only, no collaboration yet) — `create-watchlist`, `manage-list-items`
6. `membership` function + collaboration + the permission fan-out stream consumer
7. Real-time subscriptions on `/lists/:id` (System Design §2.4) — do this only after permissions are solid; the self-echo reconciliation logic assumes correct auth underneath it
8. Theme system, design tokens, attribution stripe — can happen in parallel with any of the above

## Six-week budget (C-5)

The System Design's "Known Limitations" (§9) and "Out of Scope" (SRS §7) exist because of this constraint. If you're tempted to add scope, check those two lists first.
