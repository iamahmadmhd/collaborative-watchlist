# CLAUDE.md

Instructions for Claude Code working in this repository. Read this before writing any code.

## What this project is

A collaborative movie discovery & watchlist app. Authenticated members browse/search films
(TMDB-sourced), save them privately, and build watchlists that other members can collaborate
on in real time, with per-list roles (Owner/Editor/Viewer).

**Authentication is required for everything** (SRS v1.1, ADR-009). There is no guest mode.
The only unauthenticated surface is the auth screens themselves. Never add `allow.guest()`,
an identity-pool guest role, or a publicly-readable route — that reopens a surface removed
deliberately, and fails verification target V-10.

Full specs — **read these before implementing any feature you haven't touched yet**:

- `docs/SRS.md` — what the system must do. Every requirement has an ID (`FR-*`, `NFR-*`, `V-*`).
- `docs/SYSTEM-DESIGN.md` — how it's built: stack, module structure, data model, ADRs.

**Rule: cite requirement IDs.** When implementing a feature, reference the FR-/NFR- ID it
satisfies in the PR description or commit message (e.g. "Implements FR-ITEM-2, backed by the
composite-key `attribute_not_exists` condition per §5.1"). If you can't find an ID for
something you're about to build, stop and ask — it may be scope creep (see "Out of Scope" in
the SRS §7) or a gap that needs a decision, not silent invention.

## Tech stack (fixed — do not substitute without asking)

| Concern         | Choice                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Framework       | React 19 + TypeScript (strict)                                                                      |
| Build           | Vite                                                                                                |
| Package manager | **pnpm** — not npm, not yarn                                                                        |
| Routing         | TanStack Router (typed, Zod-validated search params)                                                |
| Server state    | TanStack Query v5                                                                                   |
| Backend         | AWS Amplify Gen 2 (`aws-amplify/api`, `aws-amplify/auth` — subpath imports only, never the barrel)  |
| UI primitives   | Base UI (wrapped once in `src/shared/ui`, never imported elsewhere)                                 |
| Forms           | react-hook-form + Zod                                                                               |
| Styling         | Tailwind CSS v4 (`@theme inline`, custom properties, class-based dark mode)                         |
| Icons           | Heroicons                                                                                           |
| Reordering      | dnd-kit (lazy-loaded, `/lists/:id` only)                                                            |
| Validation      | Zod (shared between TMDB parsing and forms)                                                         |
| Testing         | Vitest, React Testing Library, MSW, Playwright, vitest-axe                                          |
| Lint            | ESLint + `eslint-plugin-boundaries` (enforces the FSD rules below — not optional, not a suggestion) |
| Bundle tracking | rollup-plugin-visualizer, wired from week one                                                       |

Explicitly **not** used, and why (don't reintroduce them): `@aws-amplify/ui-react`
(ADR-005 — bundle weight, unthemeable), Headless UI (ADR-003 — no OTP/Tooltip),
TanStack Form (ADR-004 — overkill for 9 small forms), Amplify `observeQuery`
(ADR-002 — no pagination, no optimistic-write seam), a global store (Redux/Zustand/etc —
state ownership is fully covered by the four categories below).

## Naming

- **kebab-case for all files and folders**, no exceptions — `movie-card.tsx`, not
  `MovieCard.tsx` or `movieCard.tsx`. This applies inside every FSD layer
  (`features/save-movie/`, `entities/watchlist/api/list-items.ts`, etc.), to Amplify
  function folders, to test files (`watchlist-permissions.test.ts`), and to config
  files. Component _names_ inside a file are still `PascalCase` per normal React
  convention — this rule is about the filesystem, not the exported identifier.
- **One exception: `src/app/router/`.** TanStack Router's file-based routing assigns
  meaning to filenames — `__root.tsx`, `route.tsx`, `index.tsx`, `_layout.tsx`,
  `$movieId.tsx`. These are a framework contract; the router will not resolve them
  under any other name. Lint is configured to skip both filename and folder checks
  there. Do not rename these to satisfy the convention, and do not put non-route code
  in this directory — it's scanned as `routesDirectory` (System Design's Module
  Structure section, below), so anything dropped in here is either a route or a lint
  workaround. Router setup that isn't itself a route (e.g. `getRouter()`) lives at
  `src/app/get-router.tsx`, a sibling of the directory, not inside it.

## Visual design reference

Screen-level visual design (System Design §10 listed this as an open item — tokens
and layout principles only, no screens) now lives in a Claude Design file:
<https://claude.ai/design/p/ea2f1992-bc6d-4836-b476-2c17256de9c1?file=Repertory+UI+Board.dc.html>

That link requires the project owner's Claude.ai login — Claude Code cannot fetch it
directly. When implementing UI, ask the person running the session to paste the
relevant screen's layout/spacing/component details, or export and drop images into
`docs/design/` for reference, rather than guessing at screen composition. The token
system in `src/app/styles/tailwind.css` and Design System §3 remain the source of
truth for colour, type, and the attribution-stripe mechanism regardless of what the
board shows — if the board conflicts with a token or an ADR, the token/ADR wins and
the discrepancy should be flagged, not silently resolved either way.

## Module structure — Feature-Sliced Design

```text
src/
  app/        providers/ router/ (file-based routes) get-router.tsx layouts/ styles/
  pages/      discover/ search/ movie-detail/ saved/ watchlists/ watchlist-detail/ settings/ auth/
  features/   save-movie/ manage-list-items/ manage-members/ toggle-watched/
              create-watchlist/ filter-discovery/ claim-handle/
  entities/   movie/ (ui/ model/ api/)  watchlist/ (ui/ model/ api/)  member/ (ui/ model/)
  shared/     ui/ lib/ config/
```

`src/app/router/` holds only TanStack Router's file-based route files (`__root.tsx`,
`index.tsx`, etc. — scanned via `routesDirectory` in `vite.config.ts` and `tsr.config.json`).
The router-instantiation module (`getRouter()`) lives one level up, at
`src/app/get-router.tsx` — it isn't a route, so it stays out of the scanned directory
rather than relying on the router-plugin's `-`-prefix exclusion convention. `src/app/router/`
is treated as part of the **app layer** for boundary purposes: route files compose pages,
wire loaders and guards, and own no domain logic. Keep them thin — a route file should
import a page component and configure it, not contain screen markup. If a route file is
growing logic, that logic belongs in the corresponding `pages/` slice.

(TanStack Router's plugin default is `src/routes/` at the repo root; this project nests it
under `src/app/router` instead for FSD tidiness, via the `routesDirectory` option in both
`TanStackRouterVite()` in `vite.config.ts` and `tsr.config.json`, the config the `tsr generate`
CLI reads. If you ever move it again, both configs and the two lint patterns in
`eslint.config.js` that reference the routes location need to move together.)

Hard rules, enforced by `eslint-plugin-boundaries` (a build should fail, not just look wrong):

- A layer imports **only** from layers strictly below it: `app > pages > features > entities > shared`.
- Slices within a layer never import each other (`manage-members` never imports `manage-list-items`).
- Features are verbs, entities are nouns. If you're about to create a "widgets" layer or an
  entity that's actually an action, stop — this project deliberately has no widgets layer
  (no cross-page composite blocks exist yet; don't add one speculatively).
- No Base UI import outside `shared/ui`. Every primitive gets wrapped once there.
- `aws-amplify/api` and `aws-amplify/auth` only — never `import { ... } from 'aws-amplify'`.

## State ownership — one owner per category, no exceptions

| Category                                   | Owner                                        |
| ------------------------------------------ | -------------------------------------------- |
| Server state (TMDB, lists, items, members) | TanStack Query                               |
| URL state (search, filters, pagination)    | TanStack Router search params, Zod-validated |
| UI state (dialogs, drawers)                | local `useState`/`useReducer`                |
| Session state                              | Amplify Auth via app provider                |

If you find yourself reaching for a new global store or context to hold data that fits one
of these categories, you're duplicating an owner — don't.

## Real-time (`/lists/:id`) — read System Design §2.4 before touching this

- Subscription opens on mount, closes on unmount. Filtered by `watchlistId`, never global.
- Three writers into one cache entry: initial `list()`, optimistic `onMutate`, inbound
  subscription events.
- **Self-echo**: reconcile by server id (temp id → replaced `onSuccess` → subscription event
  for that id no-ops). Never reconcile by `addedBy === currentUser` — breaks with two tabs open.
- On subscription interruption: refetch, don't assume continuity (FR-SYNC-5).

## Authorization — this is the project's core claim, treat it as load-bearing

- Server-side enforcement only (NFR-SEC-1). Client checks (`useWatchlistRole`) are
  presentational — they hide buttons that would fail server-side, they are never the control.
- Permission fields (`ownerId`, `editors`, `viewers`) are writable only via `allow.resource(membershipFn)`
  — there must be no user-facing write path to them, ever (FR-MEM-9 / NFR-SEC-2). If a change
  you're making would let an Editor touch those fields, stop.
- `WatchlistItem` carries denormalised `editors`/`viewers` arrays copied from its parent
  (ADR-001). Don't "clean this up" into a parent lookup — that breaks subscription authorization.
- Every cell of the SRS §6.1 authorization matrix needs an automated test **against the API**,
  not the UI. A passing UI test that a button is hidden proves nothing about the security property.
- Route guards (v1.1): every route outside the auth group sits behind a `beforeLoad` check on
  a shared parent route, not per-route. Redirect to sign-in carrying the requested path, return
  there on success (FR-DISC-6). The guard must distinguish "session not yet resolved" from
  "not authenticated" — conflating them bounces signed-in members to sign-in on every hard
  refresh. Like `useWatchlistRole`, the guard is presentational: AppSync rejects the operations
  regardless.

## Before writing code on a new area

1. Grep `docs/SRS.md` for the relevant `FR-`/`NFR-` prefix (e.g. `FR-ITEM`, `NFR-SEC`).
2. Check `docs/SYSTEM-DESIGN.md` for the matching section and any ADR that constrains it.
3. Check the "Known Limitations" (System Design §9) and "Out of Scope" (SRS §7) — don't
   silently fix a documented limitation or implement an out-of-scope feature without asking.

## Commands

```bash
pnpm install
pnpm dev                 # vite dev server
pnpm test                # vitest
pnpm test:e2e            # playwright
pnpm lint                # eslint, includes boundaries check
pnpm build               # production build
pnpm build:analyze       # bundle visualizer — check against the 300KB budget (NFR-PERF-4)
npx ampx sandbox          # local Amplify backend sandbox
```

## Bundle budget (NFR-PERF-4: 300KB gzipped, eager chunk)

Eager chunk = **the auth shell only** (sign up, sign in, verify, reset). Everything behind
the auth gate — discovery included — is lazy. This inverted in v1.1 (ADR-009); if you find
a comment or doc implying discovery is eager, it's stale.

Practical consequences:

- `react-hook-form` + the Zod resolver are **eager** (five of nine forms are auth forms).
- `aws-amplify/api` and TanStack Query are **lazy** — nothing before sign-in reads server
  state. Only `aws-amplify/auth` belongs in the eager chunk.
- Zod is eager for form validation, not for TMDB parsing.

Check `pnpm build:analyze` before merging anything that adds a dependency or moves an
import across that boundary. See System Design §2.6 for the allocation table.

## Open items not yet decided (don't invent answers, ask)

CI/CD pipeline and branch model, observability/alarms, cost model, and screen-level visual
design beyond tokens are explicitly deferred (System Design §10). If a task requires a
decision in one of these areas, flag it rather than picking silently.
