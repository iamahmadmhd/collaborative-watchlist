# System Design Document

## Repertory — Collaborative Movie Discovery & Watchlist Application

Version: 1.8 Date: 12 September 2026 Companion to: SRS v1.7

Revision note (v1.8): Watched state moves out of its own table and onto the item it
describes. SRS v1.7 made the state shared rather than private, which removed the reason
`WatchStatus` was a separate owner-scoped model; a reported bug — a removed item still
counting as watched — showed the cost of that separation, since nothing mapped an item
back to the watched rows referring to it. `WatchlistItem.watchedBy` replaces the table,
so the mark cannot outlive the item that carries it and the whole class of orphan
disappears rather than being cleaned up after. A ninth function, `toggle-watched`, is
the field's only writer. Known Limitation #11 is retired: the reverse-lookup problem it
described no longer exists. Access pattern 5 is gone with the table, so opening a list
costs two queries instead of three. Affected: §4.1, §4.2, §4.4, §5.1, §5.2, §5.4, §9,
§11, and ADR-014 (new).

Revision note (v1.7): No requirement changed. This revision reconciles the document
with the implementation as built, and absorbs the rationale that had accumulated in
source comments rather than here. Five substantive corrections: §4.1 now names all
eight functions, not five; §4.4's field table is corrected — the permission fields
have **no** GraphQL write path for anyone, not an `allow.resource(membershipFn)` one;
§5.4 records that item creation moved off the generated resolver onto the
`addWatchlistItem` mutation; a new §4.6 documents the CloudFormation stack topology
the `resourceGroupName` overrides exist to satisfy; and a new §11 records
implementation status, including what is deliberately not built. §9 and §10 gain the
limitations and the one unresolved requirements question that were previously
recorded only in code. Affected: §4.1, §4.2, §4.4, §4.6 (new), §5.1, §5.4, §7.1, §9,
§10, §11 (new).

Revision note (v1.6): Poster and cast-photo images are now served from our own
CloudFront distribution instead of image.tmdb.org directly (FR-TMDB-8, new). A new
image-proxy Lambda function, fronted by CloudFront via a Function URL with Origin
Access Control, downloads from TMDB on a cache miss and caches the bytes in a
dedicated S3 bucket; the client is unchanged in shape — it still receives a
relative posterPath and picks the rendering size (FR-TMDB-4) — only the domain
posterUrl() builds against moves. Affected: §5.1, §6, §9, and ADR-013 (new).

Revision note (v1.5): The sign-up form now attempts account creation before
checking for an existing account, not the reverse. Confirmed against the deployed
user pool (a raw `InitiateAuth` call against a nonexistent email): Cognito's
account-existence protection is enabled by default on the app client and makes
sign-in return an identical-looking challenge whether or not the account exists —
no email is sent, no exception is thrown, and the client-side branch that used to
detect "this is a new member" was unreachable. Account creation isn't covered by
that protection (it must reveal a duplicate to avoid overwriting an account), so
it stays a reliable signal. See ADR-012. Affected: §2.5, §4.2.

Revision note (v1.4): The system now collects the username on its own screen,
reached only after email verification succeeds, with a live availability check
shown as the member types. Adopted here per ADR-011:
`custom:handle` (the Cognito attribute that used to carry the username to
`post-confirmation`) is retired outright — nothing needs it once the claim runs
authenticated, after verification, via `claim-username`, the primary path again
rather than Settings-only recovery. `post-confirmation` simplifies to UserProfile
creation only. `displayName` is written for the first time, from the same new screen
(FR-AUTH-5). Affected: §2.5, §4.1, §4.2, §9, and ADR-011 (new).

Revision note (v1.3): No separate sign-in screen. `/sign-up` now handles both entry points — it attempts `signIn()` with the EMAIL_OTP challenge first (a lightweight existence check), and falls back to `signUp()` only on `UserNotFoundException`, at which point a handle is required (not before, since a returning member has no reason to supply one). Matches the design board's own overview, which enumerates only "/signup and /verify" for the whole flow. Six forms now, not seven. Affected: §2.5, §4.2.

Revision note (v1.2): Authentication is passwordless per SRS v1.2 — email OTP via Cognito's native `otpLogin`, no password anywhere. `claim-handle` moves from a first-run-onboarding mutation to a `post-confirmation`-driven atomic claim at registration, with `claim-handle` retained as the narrow recovery path for a lost handle-claim race (called from Settings, not sign-up). The five password-based auth forms (sign up, sign in, verify, request reset, confirm reset) are replaced by three (sign up, sign in, verify — the last shared by both entry points). Affected: §2.5, §3.2 (token names reconciled against the screen-design board), §4.2, §4.3, §9, and ADR-010 (new).

Revision note (v1.1): Unauthenticated discovery removed per SRS v1.1. The guest identity pool mode is withdrawn, and the code-splitting boundary inverts — the eager chunk is now the authentication shell rather than the discovery shell. Affected: §2.6, §4.3, §6, §9, and ADR-009 (new). ADR-003 and ADR-005 are unchanged in decision but strengthened in rationale, since the auth forms they concern now sit on the eager path.

## 1\. Introduction

### 1.1 Purpose

This document describes how the system specified in the SRS will be built. Where the SRS states observable behaviour, this document states mechanism. Requirement identifiers (FR-\*, NFR-\*, V-\*) refer back to the SRS.

### 1.2 Architectural Drivers

Three requirements shape almost every decision here:

1. FR-MEM-9 / NFR-SEC-2 \- collaborators must not be able to escalate their own privileges. This drives the entire authorization model.
2. FR-SYNC-1 \- changes must reach collaborators live. This constrains the state architecture and rules out one otherwise-attractive data layout.
3. NFR-PERF-4 \- a 300KB eager bundle. This constrains library selection more tightly than feature needs do.

### 1.3 Architectural Style

A serverless single-page application. React client, AWS Amplify Gen 2 backend, AppSync GraphQL API over DynamoDB, with Lambda used only where generated resolvers structurally cannot do the job. TMDB is the sole external dependency, reached exclusively server-side and exclusively on behalf of an authenticated member.

The application has no anonymous surface beyond the authentication screens themselves. Every GraphQL operation, including the four TMDB proxy queries, requires a user-pool identity.

## 2\. Frontend Architecture

### 2.1 Technology Stack

| Concern         | Choice                            | Rationale                                  |
| :-------------- | :-------------------------------- | :----------------------------------------- |
| Framework       | React 19 \+ TypeScript (strict)   | SRS constraint C-1                         |
| Build           | Vite                              | fast dev, native ESM, good bundle analysis |
| Package manager | pnpm                              | strict dependency isolation                |
| Routing         | TanStack Router                   | typed, schema-validated search params      |
| Server state    | TanStack Query v5                 | single cache, optimistic mutations         |
| Backend client  | aws-amplify/api, aws-amplify/auth | subpath imports only                       |
| Primitives      | Base UI                           | 35 components, unified portal, OTPField    |
| Forms           | react-hook-form \+ Zod            | mature API, existing Zod investment        |
| Styling         | Tailwind CSS v4                   | @theme tokens in CSS                       |
| Icons           | Heroicons                         | single set, three weights                  |
| Reordering      | dnd-kit                           | lazy-loaded on list detail only            |
| Validation      | Zod                               | shared between TMDB parsing and forms      |

Testing: Vitest, React Testing Library, MSW for network mocking, Playwright for end-to-end, vitest-axe for accessibility assertions, eslint-plugin-boundaries for layer enforcement, rollup-plugin-visualizer for bundle tracking.

### 2.2 Module Structure

Feature-Sliced Design. Five layers, imports flowing strictly downward.

```text
src/
  app/
    providers/     QueryClient, Amplify config, auth, theme
    router/        route tree, guards
    layouts/       AppShell, AuthLayout
    styles/        tailwind entry, @theme tokens
  pages/
    discover/  search/  movie-detail/  saved/
    watchlists/  watchlist-detail/  settings/  auth/
  features/
    save-movie/         manage-list-items/    manage-members/
    toggle-watched/     create-watchlist/     filter-discovery/
    claim-username/
  entities/
    movie/         ui/ model/ api/
    watchlist/     ui/ model/ api/
    member/        ui/ model/
  shared/
    ui/            Base UI wrappers, primitives
    lib/           amplify client, queryClient, hooks
    config/        constants
```

Rules:

- A layer may import only from layers strictly below it.
- Slices within a layer may not import from each other.
- Features are named as verbs; entities as nouns. manage-members is a feature; member is an entity.
- Enforced by eslint-plugin-boundaries, not by convention.

Canonical FSD includes a widgets layer between pages and features. It is omitted deliberately \- this application has no cross-page composite blocks, so the layer would produce empty folders and one more placement decision per component.  
No Base UI import outside shared/ui. All primitives are wrapped once, which centralises token application and confines any future library change to one folder.

### 2.3 State Ownership

Four categories, each with exactly one owner:

| Category      | Owner                          | Examples                            |
| :------------ | :----------------------------- | :---------------------------------- |
| Server state  | TanStack Query                 | TMDB results, lists, items, members |
| URL state     | TanStack Router search params  | q, genre, page                      |
| UI state      | local useState / useReducer    | dialogs, drawers                    |
| Session state | Amplify Auth, via app provider | current user                        |

No global store. Once the server state is in TanStack Query and filters are in the URL, the remaining shared state is minimal.  
Route guards (v1.1). Every route except the auth group sits behind an authenticated-only guard, implemented as a `beforeLoad` check on a parent route rather than per-route. An unauthenticated visitor is redirected to sign in with the requested path retained in a search param, and returned there on success (FR-DISC-6). The guard is a redirect, not a security control — AppSync rejects the underlying operations regardless, per NFR-SEC-1. Session state resolving asynchronously means the guard must distinguish "not yet known" from "not authenticated", or a signed-in member is bounced to sign-in on every hard refresh.  
Search parameters are validated by Zod schemas registered on the route, giving typed useSearch() results and typed Link props. This satisfies FR-DISC-5 durably: pagination and filters survive refresh, back-navigation, and link sharing.  
observeQuery is not used. Amplify's reactive query helper merges subscriptions automatically, but offers no pagination and no seam for optimistic updates. Using it for items while using TanStack Query for TMDB would place optimistic writes and real-time updates in separate systems mutating the same visible list. See ADR-002.

### 2.4 Real-Time Integration

The /lists/:id route is the only subscription site. Mounting the route opens the subscription; unmounting closes it. FR-SYNC-2 and FR-SYNC-3 are therefore satisfied structurally rather than by discipline.  
Subscriptions are filtered by watchlistId \- never a global stream across all lists a member belongs to.  
Three writers feed one cache entry, keyed by watchlist id:

1. Initial list() on mount
2. Optimistic writes from mutation onMutate
3. Inbound AppSync subscription events

Self-echo reconciliation. A member's own mutation returns to them as a subscription event. Naive handling renders the item twice. Resolution: the optimistic item carries a temporary id; onSuccess replaces it with the server record; the subscription event for that id then dedupes to a no-op.  
Reconciliation is by server id, never by addedBy \=== currentUser \- the latter breaks when one member has two tabs open, which is the primary demonstration scenario.  
On subscription interruption the client refetches rather than assuming continuity (FR-SYNC-5).

### 2.5 Forms

Seven forms (revised in v1.4 — up from six): sign up (email only, no username field anymore — attempts account creation first, falling back to sign-in, FR-AUTH-1, §4.2, ADR-012), verify code (shared by both outcomes of that attempt), username (new in v1.4 — reached only once verification succeeds for a new member; chooses a username, live-checked as typed, plus an optional display name; runs authenticated, §4.2), claim username (the Settings-only path for a member who verified but never completed the username screen — calls the same function, §4.2), create/edit list, add member, profile settings.  
Validation ownership is exclusive. react-hook-form with Zod owns validation and form state. Base UI's Field provides label, description, and error ARIA wiring only. Base UI's own validate and Form error props are not used. Two validation systems on one input produce errors that clear at different times.  
Native inputs use a register. Base UI's Select, Combobox, and OTPField require Controller; this wiring lives inside the shared/ui wrapper for each, so it is written once per component type rather than once per form.  
Username availability checking is UX only. The username screen's live indicator reads the `Username` sentinel model directly (`allow.authenticated().to(['read'])` — no new resolver needed, since the screen already runs authenticated), but FR-AUTH-4's atomicity comes from the server-side conditional write inside `claim-username` (§4.2) — the same function whether called from the username screen or from Settings. Two members can pass the live check simultaneously; the submit path must handle server rejection gracefully.

### 2.6 Code Splitting

Split boundary (revised in v1.1): the authentication shell is eager; everything behind the auth gate, discovery included, is lazy.

This inverts the v1.0 boundary and follows directly from SRS v1.1. First paint for every visitor is now a sign-in screen, so the eager chunk must contain the auth routes and nothing else. Discovery, search, and movie detail — previously eager — move into the authenticated bundle.

The consequence that matters: react-hook-form and its Zod resolver are now eager, because five of the nine forms are authentication forms. In v1.0 the eager chunk deliberately contained no form at all. That headroom is gone.

| Package                                       | Approx. eager cost                                  |
| :-------------------------------------------- | :-------------------------------------------------- |
| react \+ react-dom                            | \~45KB                                              |
| aws-amplify/auth (subpath only)               | measure — below the v1.0 figure, which included api |
| TanStack Router                               | \~35KB                                              |
| react-hook-form \+ @hookform/resolvers        | \~12KB                                              |
| Base UI (auth subset: Field, OTPField, Toast) | measure                                             |
| Zod                                           | \~14KB                                              |

Two packages leave the eager chunk. aws-amplify/api is not needed until a member is signed in, so the eager Amplify cost falls to the auth subpath alone — the single largest saving, and it substantially offsets react-hook-form's arrival. TanStack Query moves lazy for the same reason: there is no server state to cache before authentication, since the auth calls are imperative rather than cached reads.

Zod stays eager, but for a different reason than in v1.0. It was previously eager to parse TMDB responses on the discovery path; it is now eager to validate the auth forms. Same package, same chunk, different justification — worth stating, because the v1.0 reason no longer holds and the entry would otherwise read as stale.

dnd-kit still loads only on /lists/:id.

Net effect on NFR-PERF-4: the eager chunk should shrink rather than grow. It sheds aws-amplify/api, TanStack Query, and the whole discovery surface — movie card, poster grid, TMDB Zod schemas — and gains only the form stack. The 300KB budget is easier to meet under v1.1 than under v1.0. This makes ADR-005's removal of @aws-amplify/ui-react less load-bearing than it was for bundle reasons, though that decision stands on theming grounds alone.

Rules: import aws-amplify/api and aws-amplify/auth, never the barrel. Base UI imports use per-component subpaths. @aws-amplify/ui-react is not a dependency at all (ADR-005).  
The visualiser is wired in week one. This budget is tight enough to be blown by a single careless import, and discovering that in week five is expensive. Re-measure once the auth routes land — the table above is an estimate, not a measurement.

## 3\. Design System

### 3.1 Thesis

The posters are TMDB's; the people are yours.  
The catalogue is not a differentiator \- every application using TMDB shows the same posters. Collaboration is. The interface therefore foregrounds people and attribution rather than catalogue depth.  
The reference world is the repertory cinema programme and the film archive: index cards, contact sheets, listings. Explicitly not the streaming service \- charcoal ground, red accent, edge-to-edge poster grid, hover-scale tiles \- which is the default this design exists to avoid.

### 3.2 Tokens and Theming

Tokens are named by role, not appearance. Paper and ink become meaningless when inverted; surface and text do not.

**Naming reconciled against the screen-design board in v1.2** (`docs/design/`, `Repertory UI Board.dc.html`) — the underlying colour values were already identical; only the CSS custom-property names below changed, to match what the board's own markup actually references. `text-muted` and `surface-raised` are the old v1.0/v1.1 names; the board (and the implementation from v1.2 on) uses `muted` and `raised`.

| Role            | Custom property     | Light                | Dark                 |
| :-------------- | :------------------ | :------------------- | :------------------- |
| surface         | `--surface`         | \#EAECEF             | \#131519             |
| surface-raised  | `--raised`          | \#FDFDFD             | \#1C1F26             |
| text            | `--text`            | \#191C22             | \#E6E8EC             |
| text-muted      | `--muted`           | \#5A6270             | \#9AA3B2             |
| border          | `--border`          | \#C5CAD2             | \#2E333D             |
| accent          | `--accent`          | \#1B3BD0             | \#6B8BFF             |
| accent-contrast | `--accent-contrast` | \#FFFFFF             | \#0E1117             |
| success         | `--ok`              | oklch(0.52 0.13 152) | oklch(0.78 0.13 152) |
| danger          | `--danger`          | oklch(0.52 0.19 25)  | oklch(0.72 0.16 25)  |

`--ok`/`--danger` are new in v1.2 — undocumented before this revision, but already present in the board (handle-availability state, verification-error callout) and now formalised here. Not used before the auth screens; extend to other status UI (e.g. save confirmation) as it's built, rather than inventing a second success/error convention.  
The board's `--m1`..`--m5` (member-attribution colours) are a **fixed 5-colour palette**, which conflicts with §3.4's hash-generated-per-user OKLCH formula (effectively unlimited colours). Not reconciled in this revision — out of scope for the auth-only pass that produced it. Flagging here per this document's own rule (§0 design-reference note in CLAUDE.md): do not silently resolve in either direction when next touching the attribution stripe.

The accent shifts between themes because cobalt at \#1B3BD0 falls near 3:1 on a dark ground \- failing AA and reading as dead navy.  
Implementation uses custom properties swapped by class, surfaced through @theme inline:

```css
@custom-variant dark (&:where(.dark, .dark \*));

@layer base {
    :root {
        \--surface: \#EAECEF;
        \--text: \#191C22;
        \--accent: \#1B3BD0;
    }
    .dark {
        \--surface: \#131519;
        \--text: \#E6E8EC;
        \--accent: \#6B8BFF;
    }
}

@theme inline {
    \--color-surface: var(--surface);
    \--color-text: var(--text);
    \--color-accent: var(--accent);
}
```

@theme inline is required rather than plain @theme; the latter resolves values at build time and the runtime swap never occurs.  
Three states, not two (FR-THEME-1): light, dark, system \- system by default. A binary toggle silently overrides the OS preference on first visit. When set to system, a matchMedia listener tracks live changes (FR-THEME-4).  
color-scheme is set on the root so scrollbars, form controls, and autofill follow the theme.  
Flash prevention (FR-THEME-5): an inline script in index.html reads storage and applies the class before first paint. Applying it from React after hydration produces a white flash on every load for dark-mode users.  
Poster treatment differs by theme. On the light ground, pale posters dissolve into the surface and require a hairline border plus a slight shadow. On dark they require neither. This is the concrete justification for two designed themes rather than one plus a filter.

### 3.3 Typography

| Role     | Face                | Use                     |
| :------- | :------------------ | :---------------------- |
| Display  | Bricolage Grotesque | headings, list titles   |
| Body     | Public Sans         | prose, labels, controls |
| Metadata | JetBrains Mono      | years, runtimes, counts |

The mono is doing real work: numeric metadata aligns into columns, which makes the archive reference legible rather than decorative.

### 3.4 Attribution Stripe

The signature element. Each watchlist item carries a thin vertical bar in the colour of the member who added it.  
A solo list reads as one colour; a busy shared list reads as a scannable spectrum showing who contributed what. It encodes true information rather than decorating, and no streaming interface has an equivalent because none has more than one person in the list.  
Member colours are generated, not assigned:  
hue \= hash(userId) % 360  
light \= oklch(0.55 0.15 \<hue\>)  
dark \= oklch(0.72 0.14 \<hue\>)

OKLCH rather than HSL because HSL does not hold perceived lightness constant across hue \- a yellow member at 55% lightness overwhelms a blue member at the same value. Two lightness constants give consistent weight across all members in both themes (NFR-USE-5).  
Per NFR-USE-5, colour is never the sole carrier of meaning; the stripe accompanies an avatar and name, it does not replace them.

### 3.5 Component Layer

Base UI wrapped once in shared/ui. Mapping to requirements:

| Primitive            | Use                                             |
| :------------------- | :---------------------------------------------- |
| Dialog / AlertDialog | list creation; destructive confirms (NFR-USE-3) |
| Combobox             | search autocomplete; @handle picker (FR-MEM-1)  |
| Select               | genre filter; role selection                    |
| Menu                 | per-item actions                                |
| OTPField             | email verification (FR-AUTH-2)                  |
| Field / Form         | label and error ARIA wiring                     |
| Tooltip              | role indicators (NFR-USE-2)                     |
| Toast                | mutation feedback (NFR-REL-2)                   |

A single portal and focus model across all overlays matters here because the add-member flow composes a combobox inside a dialog \- precisely the case that breaks when two libraries own two portals.  
Base UI provides ARIA and focus management, covering the keyboard half of NFR-USE-1. It provides nothing for contrast; that is entirely the token system's responsibility, verified per V-8.  
Version pinning: Base UI has shipped seven minor releases in six months, some carrying breaking changes. The exact version is pinned and not upgraded mid-project.

## 4\. Backend Architecture

### 4.1 Composition

```text
amplify/
  backend.ts                    defineBackend, CDK escape hatches
  auth/resource.ts              defineAuth \+ post-confirmation trigger
  data/resource.ts              schema, auth rules, custom operations
  functions/
    post-confirmation/          create UserProfile only (v1.4 — username claim moved out)
    tmdb-proxy/                 all four TMDB queries
    membership/                 add / remove / leave / change role
    claim-username/             username claim — primary path again in v1.4
    permission-fanout/          DynamoDB stream consumer (permissions, itemCount, owner row)
    watchlist-item/             addWatchlistItem — parent-authorized item creation
    toggle-watched/             toggleWatched — the only writer of WatchlistItem.watchedBy (ADR-014)
    delete-account/             NFR-COMP-2 cascade across six tables
    image-proxy/                CloudFront origin for cached TMDB artwork (ADR-013)
    shared/                     helpers shared between the transactional functions
```

Nine functions. The restraint the original five expressed still holds — list CRUD and saves run on Amplify's generated resolvers, and every added Lambda is a cold start, an IAM policy, a log group, and a place for defects to hide — but four more proved structurally necessary after v1.0:

- watchlist-item, because the generated create resolver cannot authorize a WatchlistItem against its parent (§4.4).
- delete-account, because NFR-COMP-2's cascade writes fields that have no GraphQL write path at all (§4.4).
- image-proxy, because FR-TMDB-8 needs an origin to fetch and cache artwork (ADR-013). It is not schema-referenced and is not part of the GraphQL surface.
- toggle-watched, because watchedBy must be writable by a Viewer but not by an Editor, and no arrangement of generated resolvers expresses that (ADR-014).

Item creation and watch status are therefore the two entries in §4.1's original "runs on generated resolvers" list that no longer do.

### 4.2 Functions

tmdb-proxy \- handles all four TMDB queries in one function, routing on the GraphQL field name. Separate functions per query would create four cold-start surfaces on the discovery path; one warm function serving all discovery traffic better serves NFR-PERF-1. Requires an authenticated caller as of v1.1 (ADR-009); the user-pool identity on each invocation is what NFR-SEC-3's per-principal throttle keys on. Holds the TMDB credential via secret(), checks the cache table, parses responses through Zod before returning.  
membership \- the transactional one. Adding a collaborator writes a WatchlistMember record and pushes the user into the parent's editors or viewers array: two tables, and FR-MEM-8 forbids an observable partial result. TransactWriteItems provides atomicity. Generated resolvers write one item each and cannot satisfy this. Remove and leave are the same transaction inverted, with different role checks.  
claim-username \- conditional write against the Username table keyed on the username string, conditioned on attribute\_not\_exists. The mechanism behind FR-AUTH-4 and V-1. Revised again in v1.4 (ADR-011): back to being the primary path, called from the new post-verification username screen (§2.5) with an authenticated session already established, rather than solely a Settings recovery mechanism (v1.2's framing). Settings still calls the same function, now for the narrower case of a member who verified but abandoned the flow before finishing the username screen. Its own conditional-write logic is unchanged.  
post-confirmation \- Cognito trigger firing once email-code verification succeeds. As of v1.4 its scope is one job: create the UserProfile record (required because Cognito cannot be queried from the client, so display names would otherwise be unavailable, FR-MEM-10). It no longer claims a username — there is no signup-time Cognito attribute to read anymore (custom:handle is retired, ADR-011); the username step now runs afterward, authenticated, via claim-username.  
toggle-watched \- the only writer of WatchlistItem.watchedBy. Two constraints meet in this function and no generated resolver satisfies both. FR-WATCH-1 lets any member who can read an item mark it, Viewers included, but WatchlistItem grants Viewers `read` only, and model-level authorization gates the mutation itself — so no field-level rule can ever hand a Viewer a way in. FR-WATCH-5 makes each member's mark theirs alone, so the field must stay unwritable by every GraphQL caller, Editors included, or an Editor could forge one. Taking the write off AppSync resolves both: the function reads the item, authorizes the caller against its own fan-out-maintained editors/viewers arrays, and writes the single element belonging to that caller. Marking appends with `list_append` under a `NOT contains` guard, so two members marking the same item concurrently cannot lose each other's write and a repeated call is idempotent; unmarking removes by index under a positional condition, because DynamoDB deletes a list element by position and a position read a moment ago is only valid while nobody else has shifted the list — the condition catches that and the bounded retry re-reads. Unlike watchlist-item there is no AppSync write-back, so no subscription event is published; see ADR-014's consequences.  
permission-fanout \- DynamoDB stream consumer; see §4.5. It carries a third responsibility beyond §4.5's two: writing the WatchlistMember(OWNER) row for a newly created watchlist. List creation runs on the generated Watchlist.create() resolver, but WatchlistMember has no user-facing write grant, so nothing on that path can write the owner's own membership row — without it the byUser index (access pattern 3) would never surface a member's own new list back to them. A dedicated createWatchlist Lambda writing both transactionally would close the eventual-consistency window this introduces; the stream already fires on every Watchlist write, so one more Put there was judged the smaller addition, consistent with the eventual consistency itemCount and permission propagation already accept.  
watchlist-item \- backs the addWatchlistItem mutation. The generated create resolver can only check the editors array the caller just sent, so any authenticated member could have inserted an item into any watchlist by naming its id and listing themselves. This function reads the parent Watchlist server-side, checks Owner-or-Editor, and stamps editors/viewers, addedBy and addedAt itself. Its parent read is a raw DynamoDB GetItem, not an AppSync query — Watchlist's permission fields carry field-level rules naming only user-pool principals, so an IAM-mode read could return exactly those fields nulled. Its write, by contrast, goes back through AppSync deliberately: only a mutation passing through AppSync publishes the onCreateWatchlistItem subscription event §2.4 depends on.  
delete-account \- NFR-COMP-2. Deletes the caller's profile, saved films, watched records, owned watchlists and other memberships across seven tables. It does not delete the Cognito user: the client calls self-service deleteUser() after this mutation returns. That order is load-bearing — a failure mid-cascade leaves a still-signed-in member who can retry, and every step is idempotent against a partial prior run, whereas the reverse order would strand a signed-out member with orphaned data and no way to retry. Two decisions it encodes: a watchlist the member owns is cascade-deleted in full, collaborators included, rather than blocking deletion pending an ownership transfer; and a watchlist they merely collaborate on is left, with their WatchlistMember row removed, which anonymises their byline on items they added (the detail page builds its labels from current members only) without touching WatchlistItem.addedBy.  
image-proxy \- CloudFront's origin for cached TMDB artwork (ADR-013, §6). Reached only through an IAM-authenticated Function URL restricted to CloudFront by Origin Access Control; it never sees a direct browser request. Paths are validated against a tight pattern — two known sizes, a flat hash filename — which is the SSRF guard on the upstream fetch.

Two implementation notes that apply across the Lambda-backed custom operations, because both are non-obvious and both were found the hard way:

- **Dispatch is by argument shape, not `event.info.fieldName`.** In this deployment `event.info` arrives undefined for Lambda-backed multi-operation custom queries and mutations, while `event.identity` and `event.arguments` are present. Both tmdb-proxy and membership route on their arguments' own shape instead, which works because each function's operations have mutually distinguishable argument sets.
- **A raw SDK write must set `createdAt`/`updatedAt` explicitly.** Amplify populates them inside the generated resolver, which membership, permission-fanout, claim-username and delete-account all bypass, and the generated schema marks both non-null — so an item missing one does not merely lack a timestamp, it resolves to null in its entirety on read, via GraphQL null-propagation.

### 4.3 Authentication and Authorization Modes

| Mode                 | Applies to                                                                   |
| :------------------- | :--------------------------------------------------------------------------- |
| User pool            | every client-facing operation without exception, TMDB proxy queries included |
| IAM (allow.resource) | functions writing back into Data                                             |

The guest identity pool mode is withdrawn in v1.1. It existed solely to serve FR-DISC-1's unauthenticated discovery, and with that requirement gone there is no unauthenticated identity to provision. Removing it is a simplification, not a workaround: there is now exactly one client-facing authorization mode, and any operation reachable without a user-pool token is by definition a defect. V-10 asserts this.

### 4.4 Authorization Model

The core problem: WatchlistItem occupies its own DynamoDB table. AppSync evaluates authorization rules against fields on the record being accessed; there is no built-in traversal to a parent. Membership lives on Watchlist, but permission must be enforced on WatchlistItem.  
Chosen approach \- denormalised permission arrays. Each WatchlistItem carries editors and viewers arrays copied from its parent:  
allow.ownersDefinedIn('editors') // full CRUD  
allow.ownersDefinedIn('viewers').to(\['read'\]) // read only

Generated resolvers work unmodified, and subscriptions authorize natively because AppSync filters on exactly these fields. See ADR-001 for the alternatives and why they were rejected.  
Privilege escalation is closed structurally. allow.ownersDefinedIn('editors') would otherwise grant editors update rights on Watchlist including the editors field itself \- allowing an editor to remove the owner. Field-level rules prevent this. In Amplify Gen 2, a field's own .authorization() **replaces** the model-level rules for that field rather than adding to them, which is what makes the table below exhaustive:

| Field                          | Write permission                            |
| :----------------------------- | :------------------------------------------ |
| name, description              | owner, editors                              |
| ownerId                        | owner, on create only — write-once          |
| editors, viewers, itemCount    | nobody, over GraphQL — no create, no update |
| WatchlistItem.watchedBy (v1.8) | nobody, over GraphQL — no create, no update |

The v1.0 table recorded the permission fields as "allow.resource(membershipFn) only". That was never implementable and the built system is stronger than it described: `allow.resource()` grants a Lambda access _through_ AppSync, and the membership function never goes through AppSync at all. FR-MEM-8 requires an atomic write across Watchlist and WatchlistMember, AppSync has no transactional multi-model mutation, so membership (and delete-account, and permission-fanout) write DynamoDB directly under IAM grants. The correct closure is therefore that **no caller, the Owner included, holds `update` on these fields through the API** — post-creation they are unreachable from any GraphQL request, and those functions' own IAM-granted table access is the only way they ever change. FR-MEM-9 holds at the API layer rather than depending on application logic that could be bypassed.

Three consequences worth stating, each of which was a real hole before it was closed:

- **`ownerId` is the model's ownership field**, via allow.ownerDefinedIn('ownerId').identityClaim('sub'), not merely a string the owner may write. Under a default allow.owner() rule, ownership rode on a separate auto-populated field while ownerId stayed an unconstrained client-supplied string — so a member could create a watchlist carrying someone else's sub, and permission-fanout would then write an OWNER membership row for that victim.
- **`itemCount` carries no `.default(0)`, and its absence is load-bearing.** Field-level authorization is checked against the mutation's write set, and a default puts the field in that set even when the caller never mentions it — so with `create` granted to nobody, every Watchlist.create() failed on a field the client had not sent. Nothing depends on the zero: DynamoDB's ADD treats a missing number as 0.
- **`WatchlistItem.watchedBy` denies `update` to every caller, for a reason unrelated to permissions.** It is not a permission field — nothing authorizes off it — but it is the one field on the row that a member must write and must not be able to write on anyone else's behalf (FR-WATCH-5). Left to the model-level rules, the Editor `update` grant would cover it, and one Editor could mark an item watched for every other member or clear their marks. The rule that closes this also closes the ordinary write path, so `toggle-watched` writes it over the raw DynamoDB SDK — the same wall claim-username hits, and for the same reason: `allow.resource()` has no field-level form. See ADR-014.
- **WatchlistItem has no `create` grant for anyone.** A generated create resolver can only check that the caller appears in the editors array the caller itself just sent, and watchlistId is likewise part of the create input — so a client-facing create grant let any authenticated member insert an item into any watchlist. Creation goes through the addWatchlistItem mutation (§4.2); update and delete remain client-facing, since both check the item's fan-out-maintained array, which is no longer forgeable.

Member enumeration (NFR-SEC-7) is closed the same structural way. UserProfile and Username both grant `get`, not `read` — `read` generates both the point read and a `list` query, which exposed the entire member directory and every username→userId pair to any signed-in caller. Restricting to `get` removes those queries from the generated schema altogether, leaving only the exact-match lookups §7.1 describes. UserProfile.username additionally carries its own field-level rule granting read to any member and write to nobody: without it, the model-level owner `update` grant covered it, and any member could display a handle they had never claimed — bypassing the sentinel entirely. claim-username therefore writes that field over the raw DynamoDB SDK, since `allow.resource()` has no field-level form that could exempt it.

### 4.5 Permission Fan-Out

A DynamoDB stream on the Watchlist table invokes permission-fanout. The function compares old and new images; if editors or viewers changed, it queries affected items and rewrites their permission arrays via BatchWriteItem in chunks of 25\.  
Enabling the stream requires the CDK escape hatch in backend.ts \- Amplify Gen 2 does not expose stream configuration declaratively, so the underlying CFN table is reached through backend.data.resources.tables.  
Three properties:

- Idempotent. The operation is an overwrite, not a delta, so retries are safe.
- Dead-letter queue required. Silent failure means stale permissions with nothing surfacing.
- Bounded. Maximum 20 members (FR-MEM-7) and lists of a few hundred items make the 30-second window in NFR-SEC-4 realistic rather than aspirational.

The same function also maintains itemCount from the WatchlistItem stream (§5.4).  
The hot path is unaffected. Fan-out fires only on membership change, which is rare. Adding a movie writes one item, copying the arrays down from the parent at creation.

### 4.6 Stack Topology and CDK Wiring

Amplify Gen 2 synthesizes each function into a nested CloudFormation stack. Two nested stacks that reference each other cannot be ordered, and CloudFormation fails the deployment with CloudformationStackCircularDependencyError. Most of the non-obvious wiring in `backend.ts` and in the functions' `resource.ts` files exists to keep every such reference one-directional.

The rule: a function that takes any grant on a data-stack resource — a `Table.grant()` in backend.ts, or a schema-level `allow.resource()` — must set `resourceGroupName: 'data'`, merging it into the data stack so the grant becomes an intra-stack edge rather than a return edge against data's existing `.handler()` reference to it. membership, claim-username, delete-account and watchlist-item all do this for that reason. permission-fanout does it for a subtler one: it is not schema-referenced at all, but without an explicit group it lands in the shared catch-all "function" stack alongside tmdb-proxy, whose four `.handler()` references supply the data→stack edge that permission-fanout's own table grants would then close. That leaves an invariant on the catch-all stack — it may hold only functions with no data-stack grant of their own. tmdb-proxy and image-proxy satisfy it today; if image-proxy ever needs a data-stack resource it must move to `'data'` in the same change.

post-confirmation is the mirror case. It is grouped into the **auth** stack, because auth/resource.ts wires it as a Cognito trigger, and the data stack already depends on the auth stack one way (defineData's userPool authorization mode needs the User Pool as its authorizer). A plain Table.grant() to it would create the return edge. `allow.resource(fn)` only ever points data-stack → function's-stack, so it stacks harmlessly on the existing dependency — which is why post-confirmation's UserProfile.create() goes through that grant rather than a raw table grant.

The image CDN (bucket, distribution, Function URL) is created inside image-proxy's own nested stack via `Stack.of()`, not a new sibling stack, for the same reason.

Four further constraints the escape hatches encode:

- **Streams.** Amplify Data's default per-model tables are a `Custom::AmplifyDynamoDBTable` custom resource, not plain CfnTable L1s, so `cfnResources.cfnTables` is empty and the escape hatch is `cfnResources.amplifyDynamoDbTables`, keyed by model name. The wrapper exposes only setters, with no getter for the stream ARN, so backend.ts reaches the underlying CfnResource to `GetAtt('TableStreamArn')` — the table's own `tableStreamArn` is fixed at synth time before the override runs and stays undefined.
- **Transaction IAM.** `grantReadWriteData()` omits `dynamodb:TransactWriteItems`, and that action alone is not sufficient either: DynamoDB authorizes a transaction against the per-item action of every item in it as well as the call itself. Each grant is scoped to exactly the actions its handler performs.
- **GSI grants.** `Table.grant()` only authorizes the base table ARN. It adds `${tableArn}/index/*` only for a table that tracked its own `addGlobalSecondaryIndex()` calls, which a reference to an Amplify Data table never does — so every query against a named index needs its own explicit policy statement.
- **Environment timing.** Table names for the functions that write DynamoDB directly can only be injected in backend.ts, after `backend.data`'s tables exist. They are read via `process.env` rather than the typed `$amplify/env` import, which only reflects environment declared at the `defineFunction` call site.

CloudFront's origin access needs both halves: `FunctionUrlOrigin.withOriginAccessControl()` adds a permission for `lambda:InvokeFunctionUrl`, but the signed origin request is rejected with 403 until the function also allows `lambda:InvokeFunction` from the CloudFront service principal, scoped by sourceArn to the one distribution.

## 5\. Data Design

### 5.1 Models

| Model           | Primary key           | Notes                                                                |
| :-------------- | :-------------------- | :------------------------------------------------------------------- |
| UserProfile     | id (Cognito sub)      | username, displayName, avatarUrl                                     |
| Username        | username              | uniqueness sentinel; conditional write target                        |
| Watchlist       | id                    | ownerId, editors\[\], viewers\[\], itemCount                         |
| WatchlistMember | (watchlistId, userId) | role, joinedAt                                                       |
| WatchlistItem   | (watchlistId, tmdbId) | snapshot, addedBy, position, editors\[\], viewers\[\], watchedBy\[\] |
| SavedMovie      | (userId, tmdbId)      | snapshot, savedAt                                                    |

Composite primary keys do substantial work. Amplify's generated create resolver includes an attribute\_not\_exists condition on the primary key, which gives FR-ITEM-2 \- no duplicate film in a list \- at the database layer, with no check-then-write race. The same holds for double-saving and duplicate membership.  
WatchlistMember includes owners, with role OWNER. Without this, listing a member's watchlists requires two queries merged client-side. One uniform membership table simplifies every read path.  
WatchlistMember and the permission arrays are not redundant. The arrays feed AppSync authorization rules. The table answers "which lists am I in?" via a byUser index and holds role metadata. Two representations serving two distinct purposes.

### 5.2 Access Patterns

| \#  | Screen         | Pattern                   | Resolution                           |
| :-- | :------------- | :------------------------ | :----------------------------------- |
| 1   | /saved         | saved films, newest first | SavedMovie GSI byUserAndDate         |
| 2   | discovery grid | is this film saved?       | in-memory set, one query per session |
| 3   | /lists         | my lists with role        | WatchlistMember GSI byUser           |
| 4   | /lists/:id     | items in list             | WatchlistItem PK query               |
| 5   | /lists/:id     | members and roles         | WatchlistMember PK query             |
| 6   | /lists/:id     | my role                   | point read                           |
| 7   | add member     | @username → user          | Username point read                  |

Pattern 2 warrants emphasis. FR-SAVE-2 requires a saved state on every card in a discovery grid. Per-card lookup is 20 point reads per scroll. Instead, the user's saved tmdbId values are fetched once into a Set and checked in memory \- saved films are personal-scale, a few hundred at most. Invalidated on save or unsave.  
Pattern 6 is a genuine point read thanks to the composite key, which matters because useWatchlistRole runs on every render of the detail page.  
Opening a watchlist costs two queries \- items and members - independent of item count, satisfying NFR-PERF-2. It cost three until v1.8: watched state arrived on its own query against a separate table, and now rides the item rows (ADR-014).

### 5.3 Ordering

Fractional indexing, not sequential integers. With integers, moving one item rewrites every subsequent position. Under FR-SYNC-1 this is severe: 50 rewritten items produce 50 subscription events fanning out to every connected collaborator for a single drag.  
Dropping between 1.0 and 2.0 writes 1.5 \- one write, one event, regardless of list length (V-9).  
position is stored as a string rank rather than a float, avoiding precision collapse after repeated insertion into the same gap. Ranks are rebalanced lazily when they grow long.  
Items sort in memory, so no index is required for ordering.

### 5.4 Derived Counts

FR-LIST-6 requires an item count without loading items. There is no server-side hook on item writes to increment the parent — and since v1.7 item creation runs through the addWatchlistItem mutation (§4.2) while deletion still runs on the generated resolver, so a hook in the creating function would cover only half the traffic in any case.  
Resolution: extend permission-fanout into a general stream consumer handling both tables, performing an atomic ADD on Watchlist.itemCount from the WatchlistItem stream. INSERT adds one, REMOVE subtracts one, MODIFY (a reorder, a permission fan-out, or a watched-toggle — the last of these a real WatchlistItem write since v1.8) is ignored. The update is conditioned on `attribute_exists(id)`, since UpdateItem upserts by default and a REMOVE event can arrive after a cascading list deletion has already removed the parent — resurrecting it as a phantom {id, itemCount} row.  
Rationale: that function already owns cross-table consistency and already has a dead-letter queue. The count becomes eventually consistent alongside permissions \- one consistency story rather than two.

### 5.5 Cache Table

Plain CDK, not an Amplify model. Only tmdb-proxy touches it and it must not appear in the GraphQL schema.  
TmdbCache  
PK cacheKey "movie\#603" | "search\#the-matrix\#p1" | "trending\#week"  
payload string JSON  
expiresAt number epoch seconds, TTL attribute

| Key pattern  | TTL        |
| :----------- | :--------- |
| genres       | 7 days     |
| trending\#\* | 1 hour     |
| discover\#\* | 1 hour     |
| movie\#\*    | 24 hours   |
| search\#\*   | 15 minutes |

DynamoDB TTL is not prompt \- deletion can lag up to 48 hours past expiry. The Lambda must compare expiresAt in code and treat stale-but-present as a miss. TTL is storage cleanup, not correctness. Treating row existence as a cache hit would serve day-old search results.  
Cache keys are normalised before use \- search terms lowercased and trimmed, filter parameters sorted \- or The Matrix and the matrix occupy separate entries and halve the hit rate.

### 5.6 Capacity

On-demand billing throughout. Traffic is spiky and near zero at rest, which is the shape provisioned capacity handles worst.

## 6\. TMDB Integration

Four queries: discoverMovies, searchMovies, getMovieDetails, getGenres. All Lambda-backed, all requiring a user-pool identity (SRS v1.1, FR-DISC-1).  
Credential handling (FR-TMDB-1): TMDB's bearer Read Access Token, held in SSM Parameter Store as the `TMDB_ACCESS_TOKEN` secret and referenced via Amplify Gen 2's secret() helper. Sent to TMDB in an Authorization header, never as a query parameter — keeps it out of URLs and access logs, and out of the client bundle and any committed .env.  
Normalisation (FR-TMDB-3): responses are parsed by Zod schemas and mapped to application-defined camelCase types. TMDB's field naming never reaches the GraphQL schema. Coupling the API contract to a third party's shape would make provider substitution touch every component. Zod also enforces the SRS position that TMDB is an untrusted input \- shape drift fails loudly rather than propagating undefined.  
Image paths (FR-TMDB-4): relative paths are returned, not full URLs. The client selects the rendering size \- w185 for grid cards, w500 for detail. Server-side URL construction would ship 500px images into 120px cells.  
Image hosting (FR-TMDB-8, v1.6, ADR-013): the URL the client builds from that relative path points at our own CloudFront distribution, not image.tmdb.org. image-proxy (a Lambda behind CloudFront, via a Function URL restricted to CloudFront by Origin Access Control) fetches from TMDB on a cache miss and caches the bytes in a dedicated S3 bucket, keyed by the same {size, path} pair the client already picks. TMDB image paths are content-addressed, so a cached object is never wrong \- only, rarely, superseded by a re-shot poster at the same path, which a 90-day S3 lifecycle expiry bounds.  
Snapshots (FR-TMDB-5): title, poster path, and release year are denormalised onto WatchlistItem and SavedMovie. Cost: occasional staleness against TMDB. Benefit: a 50-item list renders from one query rather than 50 external calls (FR-ITEM-6). A background refresh job is a viable later addition.  
Degradation (FR-TMDB-7 / NFR-REL-1): because lists render from snapshots, TMDB unavailability degrades discovery and search only. Authentication and stored data remain fully functional.  
Attribution (FR-TMDB-6 / NFR-COMP-1): TMDB logo and the required non-endorsement statement in the footer. Contractual, not optional.  
Rate limiting (NFR-SEC-3, revised): the threat model changes under v1.1 but does not disappear. Anonymous scraping is closed structurally — there is no unauthenticated surface left to scrape. What remains is quota exhaustion by an authenticated principal, whether malicious or merely a runaway client loop, and credential-stuffing against the Cognito endpoints.

Two controls, because they defend different things:

- A WAF rate-based rule stays attached to the AppSync endpoint, now keyed to throttle per authenticated principal rather than per anonymous source. AppSync still has no native per-caller throttle.
- Cognito's own throttling covers the authentication endpoints, which are now the only anonymous surface in the system.

The registration requirement itself does real work here: exhausting the TMDB quota now costs an attacker a verified email address per identity, which is a materially higher bar than an unauthenticated GET.

## 7\. Cross-Cutting Concerns

### 7.1 Security Summary

| Requirement | Mechanism                                                                                   |
| :---------- | :------------------------------------------------------------------------------------------ |
| NFR-SEC-1   | AppSync rules; client checks presentational only                                            |
| NFR-SEC-2   | field-level rules; permission fields have no GraphQL write path at all (§4.4)               |
| NFR-SEC-3   | WAF rate-based rule                                                                         |
| NFR-SEC-4   | stream fan-out, bounded by member and item caps                                             |
| NFR-SEC-5   | SSM Parameter Store via secret()                                                            |
| NFR-SEC-7   | `get`-only grants on UserProfile and Username — no list query exists; emails never returned |

useWatchlistRole centralises client-side permission reasoning in one hook, making it evident by inspection that the client never enforces \- it only avoids rendering controls that would fail server-side.

### 7.2 Error Handling

Optimistic mutations use onMutate / onError / onSettled with rollback. Failures surface as toasts (NFR-REL-2); silent failure is not acceptable. Every data-backed view defines loading, empty, and error states.

### 7.3 Testing Strategy

The authorization matrix in SRS §6.1 runs against the API directly, not through the UI \- testing through the interface verifies that buttons are hidden, which is not the security property being claimed.  
V-4 \- two members observing each other's changes live \- requires two Playwright browser contexts. No other tool in the stack can verify it.

## 8\. Architecture Decision Records

### ADR-001 \- Denormalised permission arrays on watchlist items

Status: Accepted  
Context: WatchlistItem is a separate DynamoDB table and inherits nothing from its parent Watchlist. Permission must nonetheless be enforced per item.  
Options:

| Option                                 | Benefit                                                | Cost                                                                                          |
| :------------------------------------- | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| A. Copy arrays onto items              | generated resolvers and native subscriptions both work | fan-out on membership change                                                                  |
| B. Pipeline resolver membership lookup | single source of truth; instant revocation             | hand-written resolvers; subscription authorization cannot run the lookup, defeating FR-SYNC-1 |
| C. Nest items in the parent record     | no auth problem at all                                 | last-write-wins on concurrent edits \- the core use case                                      |

Decision: Option A.  
B is architecturally cleaner but breaks real-time, which is a Must requirement. C fails on concurrent editing, which is the application's reason to exist.  
Consequence: For the duration of the fan-out, a removed member retains read access. Bounded to 30 seconds by NFR-SEC-4 and accepted under SRS assumption A-3 \- watchlists are low-confidentiality data. This assumption must be revisited if the application is repurposed for anything requiring genuine confidentiality.

### ADR-002 \- TanStack Query as the sole server-state cache

Status: Accepted  
Context: Amplify offers observeQuery, which merges subscription events into a reactive array automatically.  
Decision: Use TanStack Query for all server states, including Amplify models. Subscriptions write into the query cache as a side effect.  
Rationale: observeQuery has no pagination and no seam for optimistic updates. Splitting responsibilities would leave optimistic writes and real-time events in separate systems mutating one visible list, with no shared reconciliation point.  
Consequence: Subscription wiring is written manually, and self-echo must be handled explicitly (§2.4).

### ADR-003 \- Base UI over Headless UI

Status: Accepted (supersedes an initial Headless UI selection)  
Context: With @aws-amplify/ui-react rejected, five auth forms are hand-built \- including email verification code entry.  
Decision: Base UI.  
Rationale: Headless UI has no OTP input and no Tooltip. An accessible OTP field \- paste distribution, arrow navigation, auto-advance, backspace-to-previous, screen reader announcement \- is substantial work to build correctly. Base UI additionally supplies Toast, removing a dependency, and routes every overlay through one portal and focus model, which matters for the combobox-inside-dialog composition in the add-member flow. Positioning is handled by Floating UI.  
Consequence: A faster-moving API. Version pinned; no upgrades mid-project.

### ADR-004 \- react-hook-form over TanStack Form

Status: Accepted  
Context: Nine forms, none exceeding five fields.  
Decision: react-hook-form.  
Rationale: TanStack Form's advantages \- strict inference on deeply nested shapes, cross-framework portability, native fit with controlled components \- apply weakly here. Only three or four fields need Controller, and that wiring lives in shared/ui wrappers written once. Ecosystem maturity is worth more against a fixed deadline than stricter types on small forms. Naming consistency with TanStack Query and Router is not an engineering argument; the libraries are independent.

### ADR-005 \- Custom auth forms over the Amplify Authenticator

Status: Accepted  
Decision: Build auth forms against aws-amplify/auth functions directly.  
Rationale: \<Authenticator\> delivers the flows in an afternoon but is visually recognisable as an Amplify default and resists theming into a bespoke design. Removing @aws-amplify/ui-react also removes the heaviest single dependency from the bundle.  
Consequence: Roughly two additional days, and the OTP requirement that drove ADR-003.

### ADR-006 \- Fractional ordering

Status: Accepted  
Decision: String-based fractional ranks rather than sequential integers.  
Rationale: Integer positions make one reorder into N writes and, under subscriptions, N events broadcast to every collaborator. Fractional ranks make it one of each.  
Consequence: Ranks lengthen with repeated insertion into the same gap; lazy rebalancing is required.

### ADR-007 \- DynamoDB cache table over AppSync server-side caching

Status: Accepted  
Decision: A TTL-bearing DynamoDB table read and written by tmdb-proxy.  
Rationale: AppSync's built-in cache is Redis-backed with a minimum hourly charge, costing roughly $30/month regardless of traffic. A portfolio application idles most of the time. DynamoDB on-demand costs pennies and permits per-query-type TTLs.  
Consequence: Cache logic is application code, and DynamoDB's imprecise TTL requires explicit expiry comparison.

### ADR-008 \- Public handles over email lookup

Status: Accepted  
Context: Collaborators are added by locating an existing member.  
Decision: Unique public @handles.  
Rationale: An email-searchable index is a harvesting endpoint. Handles are designed to be public, so exposing lookup carries no privacy cost. Satisfies NFR-SEC-7 by construction rather than by mitigation.  
Consequence: Uniqueness requires a sentinel table and conditional write, since DynamoDB has no unique constraint beyond the partition key.

### ADR-009 \- Authentication required for all discovery

Status: Accepted (v1.1, supersedes the guest-access provisions of v1.0)  
Context: v1.0 served trending, search, and film detail to unauthenticated visitors, backed by a Cognito identity pool in guest mode. This produced two client-facing authorization modes, an anonymous request surface exposed directly to the TMDB quota, and a split-bundle strategy organised entirely around keeping the anonymous path light.  
Decision: Remove unauthenticated access. Every operation requires a user-pool identity.  
Options considered:

| Option                                     | Benefit                                                                | Cost                                                                                              |
| :----------------------------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| A. Keep guest discovery (v1.0)             | reviewers see the product without registering; conversion funnel       | two auth modes; anonymous TMDB quota exposure; eager bundle must carry all of discovery           |
| B. Remove guest access entirely            | one auth mode; quota abuse costs a verified email; smaller eager chunk | nothing visible before registration                                                               |
| C. Guest access behind a shared demo token | preserves the shop window                                              | a token in client code is not a control; reintroduces the anonymous surface under a thin disguise |

Decision: Option B.  
Rationale: the guest path bought a shop window for a catalogue that is not a differentiator — every TMDB consumer shows identical posters. It cost a second authorization mode, an anonymous quota surface, and a bundle strategy built around a path that most sessions did not use. The application's demonstrable value is the collaboration and authorization model, none of which is visible to a guest anyway. C was rejected quickly: an embedded token is a credential in client-delivered code, which V-5 exists to prohibit.  
Consequences:

- One client-facing authorization mode (§4.3). Any operation reachable without a token is a defect, asserted by V-10.
- The code-splitting boundary inverts (§2.6). react-hook-form becomes eager; aws-amplify/api and TanStack Query become lazy.
- Route guards move from decorative to load-bearing. In v1.0 an unauthenticated visitor landing on /discover was served content; in v1.1 they are redirected to sign in and returned afterwards (FR-DISC-6, rewritten).
- Nothing is visible before registration. Mitigated by a seeded demonstration account, not by re-opening the anonymous surface (SRS §2.1).

### ADR-010 \- Passwordless (email OTP) authentication over email/password

Status: Accepted (v1.2, supersedes the password-based auth built for v1.0/v1.1)  
Context: The screen-level visual design board (\`docs/design/\`, System Design §10) specified an email-plus-handle sign-up verified by a one-time emailed code, with no password anywhere and no reset flow — discovered only after the password-based auth backend (Cognito password login, \`claim-handle\` as a first-run-onboarding mutation) and all five password-based forms were already built against SRS v1.1's FR-AUTH-1/6. The board conflicted with the written spec rather than merely restyling it; per this document's own rule (§10, design-reference note), that conflict is resolved here explicitly, not silently.  
Decision: Adopt the board's flow. Reconfigure Cognito for native email OTP (\`otpLogin\`); rewrite FR-AUTH-1/3/6 (SRS v1.2) to match.  
Options considered:

| Option                                 | Benefit                                                                 | Cost                                                                                                                                                                        |
| :------------------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep password auth, restyle only    | no backend/SRS change; less rework of already-shipped code              | the board's stated flow (no password, handle-at-signup) is simply not built; screens would look right and behave wrong                                                      |
| B. Adopt the board's passwordless flow | matches the actual design intent; no password to leak, reset, or forget | Cognito reconfiguration, \`post-confirmation\` rework, three of five existing auth forms rewritten or deleted, SRS/System Design rewrite                                    |
| C. Support both, let the user choose   | preserves optionality                                                   | two auth mechanisms to secure and test for a portfolio-scale app with one real path; the board shows no such choice, so this satisfies neither the board nor a simpler spec |

Decision: Option B.  
Rationale: the design board is the more specific, more recently authored artifact for this exact question (auth screen behaviour), and a portfolio piece's stated purpose — demonstrating the collaboration/authorization model — is not served by a stale password flow nobody asked for. Amplify Gen2's \`otpLogin\` config does not actually remove Cognito's password capability at the platform level (§4.3 is unaffected — still exactly one client-facing authorization mode), it only adds email-OTP alongside it; the application achieves "no password" by never surfacing or calling the password path, not by a platform-level guarantee that it is impossible. Option C was rejected as solving a problem nobody has: the board shows one flow, and offering two increases the attack surface and the test matrix for no product benefit.  
Consequences:

- \`claim-handle\` moves from primary (first-run onboarding) to recovery-only (Settings), called when \`post-confirmation\`'s atomic claim loses a race. Its own conditional-write logic (FR-AUTH-4) is unchanged.
- \`custom:handle\` (Cognito custom attribute) carries the desired handle from the sign-up form to \`post-confirmation\`, since no authenticated session exists at \`signUp()\` time for a client-authenticated \`claim-handle\` call to be possible.
- Two of five previously-built auth forms (request reset, confirm reset) are deleted outright; sign up and verify are substantially rewritten. Sign in as a separate form does not survive even this revision — v1.3 (§2.5) folds it into sign up, since passwordless auth has nothing to distinguish "sign in" from "register" on the client side until the server says whether the account exists.
- FR-AUTH-3's "handles are unchangeable this release" limitation (§9 #6) gets one explicit exception: a member who has never successfully claimed one may still do so, via \`claim-handle\` from Settings. Changing an _already-claimed_ handle remains unsupported.

### ADR-011 \- Post-verification username step

Status: Accepted (v1.4, supersedes ADR-010's single-step registration framing for FR-AUTH-1; ADR-010's core decision — passwordless, no reset flow — stands)  
Context: \`Auth.dc.html\` (\`docs/design/\`) moved again since ADR-010 was accepted: the username is now its own screen, reached only after the emailed code is verified, with a live availability check shown as the member types. ADR-010 was built against the board's _previous_ revision — username collected inline with email, unauthenticated, via a \`custom:handle\` Cognito attribute consumed by \`post-confirmation\`. Per this document's own design-reference rule (§10), a board/spec conflict is resolved here explicitly, not silently.  
Decision: Adopt the board's current flow. Move username claiming to a new, authenticated, post-verification screen; retire the \`custom:handle\` Cognito attribute entirely (drop, not rename — nothing needs it once the claim happens after verification).  
Options considered:

| Option                                                                   | Benefit                                                                                                                                          | Cost                                                                                                                                                                                                                       |
| :----------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Keep the v1.2/v1.3 flow, restyle only                                 | no backend rework                                                                                                                                | board's stated flow isn't built; the live availability check the board now shows would have to be faked, or built as an anonymous query, which V-10 forbids                                                                |
| B. Adopt the board's post-verification flow                              | matches current design intent; makes the live availability check safe to build for real, since it runs authenticated instead of pre-verification | \`custom:handle\` retired (forces a sandbox reset — Cognito custom attributes aren't mutable in place); \`post-confirmation\` simplified; \`claim-username\`'s "recovery-only" framing (ADR-010) reverts to "primary path" |
| C. Keep collecting the username at signup, add a live-check query anyway | smaller diff                                                                                                                                     | still doesn't match the board (still one step, still pre-verification); the live check would still be an anonymous query — the exact surface V-10 exists to forbid, just under different framing                           |

Decision: Option B.  
Rationale: the board is again the more specific, more recently authored artifact for this exact question, and unlike ADR-010's predecessor conflict, this one has a clean resolution rather than a trade-off — moving the step after verification doesn't just match the board, it's what makes the board's own live-check affordance implementable without reopening the anonymous-surface prohibition ADR-009/V-10 established. Option C was rejected because it reproduces the exact defect ADR-009/V-10 close off, for the sake of a smaller diff.  
Consequences:

- \`custom:handle\` is removed from \`amplify/auth/resource.ts\` outright, not renamed to \`custom:username\` — the new flow has no use for a signup-time attribute at all. Removing a Cognito custom attribute is not an in-place operation; the deployed sandbox's user pool must be recreated.
- \`post-confirmation\` (§4.2) shrinks to one responsibility: create the bare UserProfile record. It no longer touches the Username sentinel table.
- \`claim-username\` becomes the sole username-claiming mechanism, called from two surfaces: the new post-verification username screen (primary, the common case) and Settings (recovery, for a member who verified but never finished that screen). Its own conditional-write logic (ADR-008) is unchanged — only its callers changed.
- \`displayName\` (\`amplify/data/resource.ts\`) is written for the first time, from the same new screen — FR-AUTH-5 goes from spec'd-but-unimplemented to implemented.

### ADR-012 \- Account creation attempted before sign-in, not the reverse

Status: Accepted (v1.5, corrects the call order ADR-010 originally chose; ADR-010's other decisions — passwordless, one screen for both entry points — stand)  
Context: The sign-up form (§2.5) discovers whether a visitor already has an account from the API response rather than asking them to pick the right screen (ADR-010). As originally built, it did this by attempting sign-in first and catching the "no such user" exception to detect a new member. Tested against the deployed user pool: a raw \`InitiateAuth\` call for a definitely-nonexistent email returns a full, real-looking \`EMAIL_OTP\` challenge — no exception, no email sent. \`PreventUserExistenceErrors\` is \`ENABLED\` on the app client (Amplify Gen2's default, and the same category of protection NFR-SEC-7 requires of username lookup — not a misconfiguration to remove). Sign-in-first can therefore never distinguish a new visitor from a returning one: every attempt looks like a returning member, and a first-time visitor's account is never created.  
Decision: Attempt account creation first. On a duplicate-account error, fall back to sign-in for the returning-member path.  
Options considered:

| Option                                              | Benefit                                                                 | Cost                                                                                                         |
| :-------------------------------------------------- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| A. Keep sign-in-first, disable existence protection | smallest code change                                                    | reopens exactly the member-enumeration hole NFR-SEC-7/V-10 exist to close, just on email instead of username |
| B. Swap to account-creation-first                   | reliable (confirmed against the real pool); touches no security setting | error handling keys off a different exception; the one-screen mechanism (ADR-010) itself is unaffected       |
| C. Reintroduce a separate sign-in screen            | sidesteps the detection problem entirely                                | undoes v1.3's consolidation (§2.5) for no reason connected to this defect; the board still shows one screen  |

Decision: Option B.  
Rationale: ADR-010 chose sign-in-first partly to avoid a validation trap around the username field this screen used to collect inline — not accepting an empty field silently for a new member. That concern no longer exists: ADR-011 moved username collection off this screen entirely. Nothing is lost by reversing the order, and it's the only option that's both secure and actually functional. A duplicate-account error on creation isn't suppressed by \`PreventUserExistenceErrors\` — revealing that collision is unavoidable, since silently overwriting an existing account would be worse.  
Consequences:

- The sign-up form's submit handler tries account creation first; a duplicate-account error triggers the sign-in fallback, not the reverse.
- No schema, backend function, or Cognito configuration change — this is a client-side call-order correction only.

### ADR-013 \- Image proxy/cache over direct TMDB CDN linking

Status: Accepted  
Context: A member reported being unable to load posters or cast photos — image.tmdb.org is unreachable from their network. FR-TMDB-4 already had the system return a relative image path and let the client pick the rendering size; it never said which domain the resulting URL is built against, and the implementation had silently assumed TMDB's own image CDN. No FR/NFR covered re-hosting the bytes ourselves, and §10's open items list the cost model as undecided — an image proxy has a real, if small, per-request cost. Flagged and decided explicitly (2026-09-10) rather than silently invented, per this document's own rule for exactly this situation; see FR-TMDB-8 (new, SRS v1.6).  
Decision: Re-host poster/cast-photo bytes behind our own CloudFront distribution. A new Lambda (image-proxy), reachable only via a Function URL that CloudFront invokes through Origin Access Control, serves a cache hit from a dedicated S3 bucket or, on a miss, fetches from image.tmdb.org, stores the result, and returns it. `posterUrl()` (src/entities/movie/model/movie.ts) builds against the CloudFront domain (exposed via a custom Amplify output) instead of image.tmdb.org.  
Options considered:

| Option                                           | Benefit                                                                                    | Cost                                                                                                    |
| :----------------------------------------------- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| A. Do nothing \- link to image.tmdb.org directly | zero infrastructure, zero cost, matches FR-TMDB-4's original (implicit) assumption         | the reported failure persists for any member on a network that blocks TMDB's CDN                        |
| B. Lambda Function URL + S3, no CloudFront       | fewer moving parts than C                                                                  | every repeat request re-invokes Lambda; no edge caching; higher latency and cost under real traffic     |
| C. CloudFront + Lambda Function URL (OAC) + S3   | edge-cached repeat requests skip Lambda and S3 entirely; standard, well-documented pattern | new AWS services (CloudFront, S3) and their own cost surface, on top of an already-undecided cost model |

Decision: Option C.  
Rationale: the failure is real and reported, not hypothetical, so Option A (leaving FR-TMDB-4 as originally, implicitly, built) wasn't viable. Between B and C, most image requests are repeat views of a small set of popular posters — trending lists, a shared watchlist's items — so CloudFront's edge cache does the majority of the work the DynamoDB-cache-over-Redis reasoning in ADR-007 already endorses for a different resource: keep the expensive tier (here, Lambda + S3, there, DynamoDB) off the hot path. The cost-model open item (§10) is not resolved by this ADR — it's still open — but S3 and CloudFront's pay-per-use pricing keeps a portfolio application's idle cost near zero, the same shape of trade-off ADR-007 already accepted.  
Consequences:

- New: `amplify/functions/image-proxy/` (Lambda), an S3 bucket, and a CloudFront distribution — all provisioned inside image-proxy's own auto-generated nested stack (not a new sibling stack — see amplify/backend.ts's own comment for the circular-dependency reason, the same one permission-fanout's wiring already documents).
- `posterUrl()`'s signature and FR-TMDB-4's contract (relative path in, client picks size) are unchanged; only the domain the URL is built against moves, via a new custom Amplify output (`imageCdnDomain`).
- A network-level block on our own CloudFront domain would reproduce the original failure — no defense against that is claimed here, only against TMDB's CDN specifically being blocked.
- Image bytes are cached for up to 90 days (S3 lifecycle expiry) before a re-fetch from TMDB; TMDB image paths are content-addressed, so a cache hit is never stale in a way that matters, only occasionally superseded by a re-shot image at the same path (same class of drift as Known Limitations #3).

### ADR-014 \- watchedBy on WatchlistItem over a separate WatchStatus table

Status: Accepted  
Context: A member reported that marking an item watched and then removing it left the list still counting it — "1 of 0 watched". The cause was structural, not a missing line: watched state lived in `WatchStatus`, keyed (userId, itemId) with `itemId` composed as `${watchlistId}#${tmdbId}`, and nothing deleted those rows when the item went. No client could fix it either, since `allow.owner()` lets a caller delete only their own row while an item removal by an Editor orphans every other member's. The table's only index was keyed by userId, so no reverse lookup from an item to the rows referring to it existed — the same gap Known Limitation #11 recorded for the watchlist-deletion path. Separately, SRS v1.7 inverted FR-WATCH-3: watched state is now shared across a list's members, which removes the privacy requirement that made a per-member owner-scoped table necessary in the first place.  
Decision: Drop the `WatchStatus` model and carry watched state as `WatchlistItem.watchedBy`, an array of member ids on the item itself. Add `toggle-watched` (§4.2) as the field's only writer.  
Options considered:

| Option                                                | Benefit                                                                                                        | Cost                                                                                                                                  |
| :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| A. Client deletes its own WatchStatus row on removal  | no schema change, no migration                                                                                 | fixes nothing — every other member's row still orphans, and `allow.owner()` makes it unfixable from a client by construction          |
| B. New GSI on WatchStatus keyed (watchlistId, itemId) | purely additive, no migration; permission-fanout's existing WatchlistItem REMOVE branch does the cleanup       | the orphan stays possible and merely gets swept; a second index, and a backfill for rows already orphaned                             |
| C. Flip WatchStatus's key to (itemId, userId)         | reverse lookup for free, no GSI, privacy preserved had it still been required                                  | a primary-key change is a table replacement and a migration; the orphan is still swept rather than prevented                          |
| D. watchedBy on WatchlistItem                         | the mark cannot outlive its item, so the orphan is impossible rather than cleaned up; one fewer query per list | a migration; watched state becomes readable by every member; a new function, because no generated resolver can express the write rule |

Decision: Option D.  
Rationale: B and C both leave a handler responsible for remembering to delete something, which is the shape of defect that produced the bug. D removes the failure mode instead of catching it — NFR-REL-4 becomes true by construction, and NFR-REL-3's watched-record clause holds for free. D's headline cost, that every member can now read the marks, stopped being a cost when SRS v1.7 made it the requirement; before that inversion D would have been unimplementable without hiding the array behind a computed resolver and taking the real-time path apart to do it. A is recorded because it was the first thing tried and it is worth being explicit that it is not a partial fix but no fix at all.  
Consequences:

- New: `amplify/functions/toggle-watched/`, and `WatchlistItem.watchedBy` with a field-level rule granting `read` to editors/viewers and `update` to nobody. The rule is load-bearing: without it the model-level Editor `update` grant would reach the field and let an Editor forge another member's mark (FR-WATCH-5, V-3).
- Gone: the `WatchStatus` model, its `byUserAndList` index, access pattern 5, `useWatchedSet`, and Known Limitation #11.
- The detail page derives both the item count and the watched count from one array, so they can no longer disagree — which is the reported bug's actual symptom, independent of the orphan behind it.
- `features/toggle-watched` becomes a fourth optimistic writer into the `['watchlist-items', id]` cache entry (§2.4). It is self-echo-safe for the same reason `manage-list-items` is: the key is tmdbId, known client-side.
- Watched state is not live-propagated. The write bypasses AppSync — it has to, since the field denies `update` to every GraphQL principal and `allow.resource()` has no field-level form to exempt a function — so no `onUpdate` event is published, and another member sees a mark on their next refetch. FR-SYNC-1 covers additions, removals and reorderings only, so this is within requirement; closing it would mean a custom JS resolver over the DynamoDB data source plus a custom subscription `.for(toggleWatched)`, and is deliberately left out of this change.
- A member's marks survive their removal from a list, rendering as "A former member" (FR-WATCH-6), consistent with §4.2's treatment of their byline on items they added. Account deletion is the exception: NFR-COMP-2 counts the marks as the member's own data, so `delete-account` strips them from every list it leaves.
- Migration is two-phase and one-way: `watchedBy` must ship and be backfilled from `WatchStatus` (`pnpm migrate:watched-by`) before the model is dropped, because dropping it drops the table. See the script header.

## 9\. Known Limitations

Stated explicitly rather than discovered later:

1. Revocation is eventually consistent \- up to 30 seconds (ADR-001).
2. itemCount is eventually consistent \- brief divergence after rapid additions.
3. Snapshots drift from TMDB \- titles and posters may age; no refresh job in this release.
4. Cold start on first discovery after sign-in \- discovery runs through Lambda. Node cold starts sit within NFR-PERF-1's 4-second cold budget. Provisioned concurrency would remove it but bills hourly regardless of traffic; rejected as the wrong trade for this application. Under v1.1 this lands slightly better than it did: the cold start is absorbed behind the authentication step rather than being a first-time visitor's first impression of the product.
5. Collaborators are added without consent (FR-MEM-2). Mitigated by a 20-member cap and prominent leave affordance, not by moderation.
6. Username _changes_ are not supported in this release; the sentinel table would need a release-and-claim transaction. One exception (ADR-011, v1.4): a member who verified but never completed the username screen — including one who abandoned it before submitting — may still claim a first one via \`claim-username\`, either from that screen or, later, from Settings. That is claiming, not changing; it stays a one-shot, first-claim-only operation.
7. Nothing is visible before registration (ADR-009). A reviewer or prospective user sees only a sign-in screen. Mitigated by a seeded demonstration account, not by reopening an anonymous surface.
8. Every discovery session now costs a Cognito token exchange before the first TMDB call. Negligible in latency terms against NFR-PERF-1, but it means discovery can no longer be demonstrated with a bare curl against the endpoint.
9. image-proxy (ADR-013, v1.6) adds CloudFront and S3 to the cost surface, ahead of the cost model §10 still lists as undecided — pay-per-use, so idle cost stays near zero, but not yet reconciled with whatever that model ends up being.
10. A network that blocks our CloudFront domain specifically (rather than TMDB's) would reproduce the original image-loading failure ADR-013 was written to fix. Not mitigated — out of scope for this release.
11. ~~Cascade-deleting an owned watchlist leaves other collaborators' WatchStatus rows uncleaned.~~ Retired in v1.8. The limitation was a symptom of watched state living in a table with no reverse lookup from an item; ADR-014 moved it onto the item, so there is nothing left to orphan. The same root cause produced a user-visible bug on the ordinary single-item removal path, which is what prompted the change — see NFR-REL-4.
12. A new watchlist reaches its creator's /lists screen through a DynamoDB Streams hop rather than synchronously with the create (§4.2). The client seeds its cache directly to hide the window; the same member on a second device sees the list appear a beat later.
13. The image CDN is the one publicly reachable, unauthenticated surface in the system, bounded only by a reserved-concurrency ceiling rather than a rate limit — see §10.

## 10\. Open Items

Carried forward from SRS §8:

- CI/CD pipeline, environment strategy, branch model
- Observability: logging, metrics, error tracking, alarm thresholds
- Cost model at expected scale

Raised by the implementation, unresolved:

- **Does V-10 need a carve-out for the image CDN?** The CloudFront distribution FR-TMDB-8 introduced is publicly reachable with no Cognito token, no WAF, and no per-principal throttle. V-10 as written ("Every TMDB-backed operation rejects an unauthenticated caller at the API layer") and NFR-SEC-3's framing of the authentication endpoints as "the only remaining unauthenticated surface" both predate FR-TMDB-8, and v1.6 amended neither. Either those two need an explicit carve-out for opaque public artwork — defensible, since no user data crosses that path — or the surface needs closing. That is a requirements decision, not an implementation one, and it is deliberately not answered in code.
- **The WAF rule for that distribution is missing.** A reserved-concurrency ceiling of 25 is applied instead, which caps a flood of well-formed but nonexistent image paths (each a distinct CloudFront cache key, so the edge absorbs none of it) and simultaneously guarantees image-proxy those 25, so such a flood can neither exhaust the TMDB quota nor starve the other functions. It is not a rate limit. A WAFv2 ACL scoped to CLOUDFRONT must be created in us-east-1, and Amplify Gen 2 offers no way to place a stack in a region other than the backend's own, so this needs a separate us-east-1 stack wired in by ACL ARN.

## 11\. Implementation Status

Recorded here so the gap between specification and build is explicit rather than discovered by grep. Everything in §1–§8 is built and deployed unless listed below.

**Built:** the full authentication flow (registration, verification, the post-verification username screen, sign-out, account deletion); discovery, search and movie detail over the TMDB proxy; saved films; watchlists with create, item add/remove and the full membership surface (add, remove, leave, change role); watched tracking, shared across members since v1.8 (ADR-014); real-time synchronisation on /lists/:id; the theme system; and all nine backend functions in §4.1.

**Specified but not yet built:**

| Requirement | Status                                                                                                                                                                                                                                      |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-LIST-2/3 | Renaming and re-describing a list. A feature slice of its own; the detail page has no edit affordance yet.                                                                                                                                  |
| FR-ITEM-5   | Drag reordering ("should", not "shall"). The fractional-rank helper supports general betweenness already; only append is exercised. dnd-kit is not yet imported anywhere.                                                                   |
| FR-AUTH-5   | The avatar half. `avatarUrl` is read through the model but nothing writes it — no storage backend is provisioned for uploads.                                                                                                               |
| §6.1 matrix | The authorization test matrix exists as `it.todo` cells in `tests/auth-matrix/`. This is the largest outstanding gap: §6 calls authorization the system's principal claim to correctness, and it is currently unverified by automated test. |

**Deliberately not built**, each because the data or the requirement to back it does not exist — listed so they are not mistaken for oversights: a decade filter on discovery and a genre filter on search (neither query takes such an argument); search suggestions and per-result synopsis columns (MovieSummary carries neither); an "in N of your lists" count on movie detail and member avatars on the /lists rows (neither is a documented access pattern in §5.2); a credits grid beyond cast (only `credits.cast` is mapped); the sidebar's per-list mini-rows (they need per-list member data this screen does not cheaply have); and changing the sign-in email (no requirement authorizes it).
