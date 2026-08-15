# System Design Document

## Collaborative Movie Discovery & Watchlist Application

Version: 1.1 Date: 11 August 2026 Companion to: SRS v1.1

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
    claim-handle/
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

Nine forms: sign up, sign in, verify email, request reset, confirm reset, claim handle, create/edit list, add member, profile settings.  
Validation ownership is exclusive. react-hook-form with Zod owns validation and form state. Base UI's Field provides label, description, and error ARIA wiring only. Base UI's own validate and Form error props are not used. Two validation systems on one input produce errors that clear at different times.  
Native inputs use a register. Base UI's Select, Combobox, and OTPField require Controller; this wiring lives inside the shared/ui wrapper for each, so it is written once per component type rather than once per form.  
Handle availability checking is UX only. Async validation gives immediate feedback, but FR-AUTH-4's atomicity comes from the server-side conditional write. Two members can pass the async check simultaneously; the submit path must handle server rejection gracefully.

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

| Role            | Light    | Dark     |
| :-------------- | :------- | :------- |
| surface         | \#EAECEF | \#131519 |
| surface-raised  | \#FDFDFD | \#1C1F26 |
| text            | \#191C22 | \#E6E8EC |
| text-muted      | \#5A6270 | \#9AA3B2 |
| border          | \#C5CAD2 | \#2E333D |
| accent          | \#1B3BD0 | \#6B8BFF |
| accent-contrast | \#FFFFFF | \#0E1117 |

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
    post-confirmation/          create UserProfile on signup
    tmdb-proxy/                 all four TMDB queries
    membership/                 add / remove / leave
    claim-handle/               conditional write for uniqueness
    permission-fanout/          DynamoDB stream consumer
```

Five functions, and the restraint is deliberate. Item CRUD, list CRUD, saves, and watch status all run on Amplify's generated resolvers. Every added Lambda is a cold start, an IAM policy, a log group, and a place for defects to hide. These five exist because each does something a generated resolver structurally cannot.

### 4.2 Functions

tmdb-proxy \- handles all four TMDB queries in one function, routing on the GraphQL field name. Separate functions per query would create four cold-start surfaces on the discovery path; one warm function serving all discovery traffic better serves NFR-PERF-1. Requires an authenticated caller as of v1.1 (ADR-009); the user-pool identity on each invocation is what NFR-SEC-3's per-principal throttle keys on. Holds the TMDB credential via secret(), checks the cache table, parses responses through Zod before returning.  
membership \- the transactional one. Adding a collaborator writes a WatchlistMember record and pushes the user into the parent's editors or viewers array: two tables, and FR-MEM-8 forbids an observable partial result. TransactWriteItems provides atomicity. Generated resolvers write one item each and cannot satisfy this. Remove and leave are the same transaction inverted, with different role checks.  
claim-handle \- conditional write against the Handle table keyed on the handle string, conditioned on attribute\_not\_exists. The mechanism behind FR-AUTH-4 and V-1.  
post-confirmation \- Cognito triggers creating the UserProfile record at signup. Required because Cognito cannot be queried from the client, so display names would otherwise be unavailable (FR-MEM-10).  
permission-fanout \- DynamoDB stream consumer; see §4.5.

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
Privilege escalation is closed structurally. allow.ownersDefinedIn('editors') would otherwise grant editors update rights on Watchlist including the editors field itself \- allowing an editor to remove the owner. Field-level rules prevent this:

| Field                     | Write permission                  |
| :------------------------ | :-------------------------------- |
| name, description         | owner, editors                    |
| ownerId, editors, viewers | allow.resource(membershipFn) only |

No user-facing write path to the permission fields exists at all. FR-MEM-9 therefore holds at the API layer rather than depending on application logic that could be bypassed. An editor mutating the array directly is rejected by AppSync.

### 4.5 Permission Fan-Out

A DynamoDB stream on the Watchlist table invokes permission-fanout. The function compares old and new images; if editors or viewers changed, it queries affected items and rewrites their permission arrays via BatchWriteItem in chunks of 25\.  
Enabling the stream requires the CDK escape hatch in backend.ts \- Amplify Gen 2 does not expose stream configuration declaratively, so the underlying CFN table is reached through backend.data.resources.tables.  
Three properties:

- Idempotent. The operation is an overwrite, not a delta, so retries are safe.
- Dead-letter queue required. Silent failure means stale permissions with nothing surfacing.
- Bounded. Maximum 20 members (FR-MEM-7) and lists of a few hundred items make the 30-second window in NFR-SEC-4 realistic rather than aspirational.

The same function also maintains itemCount from the WatchlistItem stream (§5.4).  
The hot path is unaffected. Fan-out fires only on membership change, which is rare. Adding a movie writes one item, copying the arrays down from the parent at creation.

## 5\. Data Design

### 5.1 Models

| Model           | Primary key           | Notes                                                 |
| :-------------- | :-------------------- | :---------------------------------------------------- |
| UserProfile     | id (Cognito sub)      | handle, displayName, avatarUrl                        |
| Handle          | handle                | uniqueness sentinel; conditional write target         |
| Watchlist       | id                    | ownerId, editors\[\], viewers\[\], itemCount          |
| WatchlistMember | (watchlistId, userId) | role, joinedAt                                        |
| WatchlistItem   | (watchlistId, tmdbId) | snapshot, addedBy, position, editors\[\], viewers\[\] |
| SavedMovie      | (userId, tmdbId)      | snapshot, savedAt                                     |
| WatchStatus     | (userId, itemId)      | watchlistId, watchedAt                                |

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
| 5   | /lists/:id     | my watched state          | WatchStatus GSI byUserAndList        |
| 6   | /lists/:id     | members and roles         | WatchlistMember PK query             |
| 7   | /lists/:id     | my role                   | point read                           |
| 8   | add member     | @handle → user            | Handle point read                    |

Pattern 2 warrants emphasis. FR-SAVE-2 requires a saved state on every card in a discovery grid. Per-card lookup is 20 point reads per scroll. Instead, the user's saved tmdbId values are fetched once into a Set and checked in memory \- saved films are personal-scale, a few hundred at most. Invalidated on save or unsave.  
Pattern 7 is a genuine point read thanks to the composite key, which matters because useWatchlistRole runs on every render of the detail page.  
Opening a watchlist costs three queries \- items, members, own watch status \- independent of item count, satisfying NFR-PERF-2.

### 5.3 Ordering

Fractional indexing, not sequential integers. With integers, moving one item rewrites every subsequent position. Under FR-SYNC-1 this is severe: 50 rewritten items produce 50 subscription events fanning out to every connected collaborator for a single drag.  
Dropping between 1.0 and 2.0 writes 1.5 \- one write, one event, regardless of list length (V-9).  
position is stored as a string rank rather than a float, avoiding precision collapse after repeated insertion into the same gap. Ranks are rebalanced lazily when they grow long.  
Items sort in memory, so no index is required for ordering.

### 5.4 Derived Counts

FR-LIST-6 requires an item count without loading items. Items are created through generated resolvers, so no server-side hook exists to increment the parent.  
Resolution: extend permission-fanout into a general stream consumer handling both tables, performing an atomic ADD on Watchlist.itemCount from the WatchlistItem stream.  
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

| Requirement | Mechanism                                                          |
| :---------- | :----------------------------------------------------------------- |
| NFR-SEC-1   | AppSync rules; client checks presentational only                   |
| NFR-SEC-2   | field-level rules; permission fields writable only by membershipFn |
| NFR-SEC-3   | WAF rate-based rule                                                |
| NFR-SEC-4   | stream fan-out, bounded by member and item caps                    |
| NFR-SEC-5   | SSM Parameter Store via secret()                                   |
| NFR-SEC-7   | handle lookup is exact-match point read; emails never returned     |

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

## 9\. Known Limitations

Stated explicitly rather than discovered later:

1. Revocation is eventually consistent \- up to 30 seconds (ADR-001).
2. itemCount is eventually consistent \- brief divergence after rapid additions.
3. Snapshots drift from TMDB \- titles and posters may age; no refresh job in this release.
4. Cold start on first discovery after sign-in \- discovery runs through Lambda. Node cold starts sit within NFR-PERF-1's 4-second cold budget. Provisioned concurrency would remove it but bills hourly regardless of traffic; rejected as the wrong trade for this application. Under v1.1 this lands slightly better than it did: the cold start is absorbed behind the authentication step rather than being a first-time visitor's first impression of the product.
5. Collaborators are added without consent (FR-MEM-2). Mitigated by a 20-member cap and prominent leave affordance, not by moderation.
6. Handle changes are not supported in this release; the sentinel table would need a release-and-claim transaction.
7. Nothing is visible before registration (ADR-009). A reviewer or prospective user sees only a sign-in screen. Mitigated by a seeded demonstration account, not by reopening an anonymous surface.
8. Every discovery session now costs a Cognito token exchange before the first TMDB call. Negligible in latency terms against NFR-PERF-1, but it means discovery can no longer be demonstrated with a bare curl against the endpoint.

## 10\. Open Items

Carried forward from SRS §8:

- CI/CD pipeline, environment strategy, branch model
- Observability: logging, metrics, error tracking, alarm thresholds
- Cost model at expected scale
