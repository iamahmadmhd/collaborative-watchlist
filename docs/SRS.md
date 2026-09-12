# Software Requirements Specification

## Repertory — Collaborative Movie Discovery & Watchlist Application

Version: 1.7 Date: 12 September 2026 Status: Approved

Revision note (v1.7): Watched state becomes shared rather than private. A collaborative
watchlist whose central signal — who has actually seen a film — is invisible to the
people collaborating on it withholds the thing that makes the list worth sharing, so
FR-WATCH-3 is inverted: every member of a watchlist now sees every member's marks.
FR-WATCH-5 and §7's "aggregate watched state" exclusion are narrowed accordingly, since
attributing a mark to a member is that aggregate; what stays out of scope is the tier
above it — counts, leaderboards, rollups. FR-WATCH-5 is repurposed to carry the
integrity property that replaces the lost privacy one: a member's mark is theirs alone
to set or clear. V-3 asserts the same thing at the API layer, in place of the privacy
property it used to assert. FR-WATCH-6 (new) records that a departing member's marks
stay put, attributed to nobody, rather than being stripped — the choice §4.2 already
made for the byline on items they added. NFR-REL-4 (new) states the orphan invariant
that NFR-REL-3 implied for watchlist deletion but nothing stated for item removal: the
gap a reported bug surfaced, and the reason this revision exists. §6.1 gains a "toggle
watched" column, the one operation a Viewer may perform. Affected: FR-WATCH-3,
FR-WATCH-5, FR-WATCH-6 (new), NFR-REL-4 (new), V-3, §6.1, §7. See System Design v1.8
§5.1 and ADR-014.

Revision note (v1.6): A member reported being unable to load poster/cast images —
image.tmdb.org is unreachable from their network. FR-TMDB-4 already required the
system to return relative image paths and let the client pick the rendering size;
it did not say which domain the resulting URL is built against, and the
implementation had silently assumed TMDB's own CDN. New requirement FR-TMDB-8 makes
that domain the system's own, not TMDB's, closing the gap explicitly rather than
leaving it implied. See System Design v1.6 §5.1, §6, and ADR-013.

Revision note (v1.5): FR-AUTH-1's registration attempt now tries account creation
before checking for an existing account, not the reverse — the order in which the
two Cognito calls run, not a change to what a visitor sees. Confirmed against the
deployed user pool: Cognito's account-existence protection (enabled by default,
the same category of guarantee NFR-SEC-7 requires for usernames) makes checking
for an existing account first indistinguishable from creating a new one — no
email is sent and no account is created either way, so a first-time visitor could
never actually register. Attempting creation first is unaffected, since revealing
a duplicate on creation is unavoidable there. Affected: FR-AUTH-1. See System
Design v1.5 §4.2 and ADR-012.

Revision note (v1.4): The system now collects the username on its own screen,
reached only after the emailed code is verified, with a live availability check
shown as the member types. FR-AUTH-1 no longer promises registration "in one step."
Running that screen after verification, while the member already holds a session, is
what makes the live availability check safe to build server-side — doing the same
check pre-verification would have been an anonymous query, which V-10 forbids. A
first-time member passes through this step once, post-verification (§2.2). Affected:
§2.2, FR-AUTH-1/3/4, FR-MEM-1/10, NFR-SEC-7, V-1, V-6. See System Design v1.4 §4.2
and ADR-011.

Revision note (v1.3): There is no separate sign-in screen. A passwordless flow makes
"sign in" and "register" the same action from the visitor's side — enter an email,
receive a code — with only the handle distinguishing a new member from a returning
one, and that distinction is discovered from Cognito's response (does an account
exist for this email), not from the visitor picking the correct screen up front.
Matches the design board's own overview, which lists only "/signup and /verify" for
the entire auth flow. Affected: §2.2 (Visitor access), FR-AUTH-1 (wording only, no
behaviour change beyond dropping "sign in" as a distinct screen).

Revision note (v1.2): Authentication is now passwordless. Registration collects an
email address and a handle together; a one-time code emailed to that address both
verifies the address and authenticates the member — no password is ever collected,
stored, or offered as a sign-in method, and there is consequently no password-reset
flow. The handle is claimed atomically at registration (once verification succeeds),
not during a separate first-run onboarding step; a member who loses that race may
still claim a handle afterward from Settings, as the one exception to handles being
otherwise unchangeable this release. Driven by the screen-level visual design board (System Design §10 /
`docs/design/`), which specified this flow — the previous password-based
implementation (auth Lambda triggers, Cognito config, and the five auth forms) is
replaced by this revision, not merely re-skinned.
Affected: §2.2, FR-AUTH-1, FR-AUTH-3, FR-AUTH-6. See System Design v1.2 §4.2/§4.3 for
the Cognito mechanism (email OTP, `custom:handle` at sign-up, `post-confirmation`
claiming) and §8 ADR-010 for the alternatives considered.

Revision note (v1.1): Unauthenticated discovery has been removed. All film discovery,
search, and detail views now require an authenticated member. The Guest user class is
withdrawn. Affected: §1.2, §1.3, §2.2, FR-DISC-1, FR-DISC-6, FR-THEME-6, NFR-SEC-3.
See System Design v1.1 §2.6 for the consequent inversion of the code-splitting boundary.

## 1\. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for a single-page web application that lets users discover films, save them privately, and build watchlists collaboratively with other registered users.  
It is written for the developer implementing the system and for any reviewer assessing it. It describes what the system must do. Component design, framework selection, and deployment topology are deferred to the accompanying System Design Document.

### 1.2 Scope

The system provides:

- Browsing and search of film data sourced from TMDB, available to authenticated members only
- Account registration with a unique public username
- Private per-user saved films
- User-created watchlists containing films drawn from TMDB
- Multi-user collaboration on watchlists with role-based permissions
- Real-time propagation of changes to collaborators viewing the same list
- Private per-user watched tracking

The system does not provide film data of its own. TMDB is the sole source of film metadata; the application stores only references and cached display snapshots.

### 1.3 Definitions

| Term         | Meaning                                                                                                                                                            |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TMDB         | The Movie Database, the external film metadata provider                                                                                                            |
| Visitor      | A person who has not authenticated. Reaches only the authentication screens; no film data is served to them. Replaces the former "Guest" class, withdrawn in v1.1. |
| Member       | A registered, authenticated user                                                                                                                                   |
| Username     | A unique, publicly visible identifier chosen by a member (e.g. @sarah)                                                                                             |
| Watchlist    | A named, ordered collection of films owned by one member                                                                                                           |
| Collaborator | A member granted access to a watchlist they do not own                                                                                                             |
| Snapshot     | Denormalised film display fields (title, poster path, release year) stored alongside a TMDB reference                                                              |
| Fan-out      | The propagation of a permission change from a watchlist to each of its items                                                                                       |

### 1.4 References

- TMDB API Terms of Use — attribution obligations, rate limits
- Domain model diagram (produced during planning, to be embedded in the System Design Document)

## 2\. Overall Description

### 2.1 Product Perspective

A greenfield, self-contained application built as a portfolio piece. It has no predecessor and integrates with exactly one external system (TMDB). The intended demonstration value lies in the collaborative authorization model and the real-time synchronisation behaviour, not in breadth of features.

Consequence of v1.1: with unauthenticated discovery removed, a reviewer sees nothing but a sign-in screen until they register. This is a real cost to a portfolio piece and is accepted deliberately — the demonstrable value was never the catalogue, which is identical across every TMDB consumer, and the collaboration model requires an account regardless. Provisioning a seeded demonstration account with pre-populated watchlists and a second collaborator is the mitigation, and is recommended before the project is submitted for review.

### 2.2 User Classes

| Class   | Description                          | Access                                                                                                                                                    |
| :------ | :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor | Unauthenticated                      | Authentication screens only — continue (sign up or sign in), verify                                                                                       |
| Member  | Registered, verified user            | Discovery, search, and all personal features; may create watchlists. A first-time member also passes through a one-time username step, post-verification. |
| Owner   | Member who created a given watchlist | Full control of that list, including membership                                                                                                           |
| Editor  | Collaborator with write access       | May add, remove, and reorder items; may not alter membership                                                                                              |
| Viewer  | Collaborator with read access        | May read items and track own watched state only                                                                                                           |

Roles are scoped per watchlist. A member may be Owner of one list and Viewer of another simultaneously.

### 2.3 Operating Environment

Modern evergreen desktop and mobile browsers. Responsive layout down to 360px viewport width. No native application, no offline capability.

### 2.4 Design Constraints

These are fixed inputs to the design phase, not outcomes of it:

- C-1 Client is a single-page React application
- C-2 Backend is AWS Amplify Gen 2 with a TypeScript-defined backend
- C-3 API is GraphQL over AWS AppSync
- C-4 Film data originates exclusively from the TMDB API
- C-5 Development budget is approximately six weeks of part-time effort

### 2.5 Assumptions and Dependencies

- A-1 TMDB API availability and terms remain unchanged. The system has a hard runtime dependency on TMDB; a TMDB outage degrades discovery but must not prevent access to existing watchlists.
- A-2 Expected concurrency is low (portfolio demonstration scale). The design need not accommodate thousands of simultaneous collaborators.
- A-3 Watchlists are treated as low-confidentiality data. This assumption underpins the eventual-consistency tolerance in NFR-SEC-4 and must be revisited if the application is ever repurposed.

## 3\. Functional Requirements

### 3.1 Authentication and Identity

| ID        | Requirement                                                                                                                                                                                                                                 | Priority |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------- |
| FR-AUTH-1 | The system shall allow registration with an email address, authenticated by a one-time code sent to that address, after which the member chooses a unique username. No password shall be collected, stored, or offered as a sign-in method. | Must     |
| FR-AUTH-2 | The system shall require email verification before granting member privileges.                                                                                                                                                              | Must     |
| FR-AUTH-3 | The system shall require each member to have a unique username, claimed atomically once email verification succeeds, or — if that claim did not happen or did not succeed — from Settings afterward.                                        | Must     |
| FR-AUTH-4 | The system shall reject a username already claimed by another member, atomically, with no window in which two members hold the same username.                                                                                               | Must     |
| FR-AUTH-5 | The system shall allow members to set a display name and avatar.                                                                                                                                                                            | Should   |
| FR-AUTH-6 | The system shall allow members to sign out. Re-authentication issues a fresh one-time code; there is no persistent credential to reset.                                                                                                     | Must     |
| FR-AUTH-7 | The system shall never expose any member's email address to any other member through any interface.                                                                                                                                         | Must     |

### 3.2 Discovery

| ID        | Requirement                                                                                                                                                                                                                                              | Priority |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-DISC-1 | The system shall present trending and popular films to authenticated members. No film data shall be served to unauthenticated callers through any interface.                                                                                             | Must     |
| FR-DISC-2 | The system shall allow full-text search of films by title.                                                                                                                                                                                               | Must     |
| FR-DISC-3 | The system shall allow filtering of discovery results by one or more genres.                                                                                                                                                                             | Must     |
| FR-DISC-4 | The system shall provide a detail view per film showing synopsis, release date, runtime, genres, poster, and cast.                                                                                                                                       | Must     |
| FR-DISC-5 | The system shall paginate discovery and search results.                                                                                                                                                                                                  | Must     |
| FR-DISC-6 | When an unauthenticated visitor requests any member-facing route, the system shall redirect them to sign in and, on success, return them to the originally requested route. Shared links to a film or watchlist shall survive the authentication detour. | Should   |

### 3.3 Saved Films

| ID        | Requirement                                                                                 | Priority |
| :-------- | :------------------------------------------------------------------------------------------ | :------- |
| FR-SAVE-1 | A member shall be able to save and unsave any film.                                         | Must     |
| FR-SAVE-2 | The system shall indicate saved state on film cards and detail views.                       | Must     |
| FR-SAVE-3 | A member shall be able to view all their saved films in a dedicated view.                   | Must     |
| FR-SAVE-4 | Saved films shall be private to the saving member and visible to no one else.               | Must     |
| FR-SAVE-5 | Saved films shall be independent of watchlists; saving a film shall not add it to any list. | Must     |

### 3.4 Watchlists

| ID        | Requirement                                                                                                            | Priority |
| :-------- | :--------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-LIST-1 | A member shall be able to create a watchlist with a name and optional description.                                     | Must     |
| FR-LIST-2 | The Owner shall be able to rename and re-describe a watchlist.                                                         | Must     |
| FR-LIST-3 | An Editor shall be able to modify a watchlist's name and description, but no other watchlist attribute.                | Must     |
| FR-LIST-4 | The Owner shall be able to delete a watchlist, cascading to its items, memberships, and associated watched records.    | Must     |
| FR-LIST-5 | A member shall be able to view all watchlists they own or collaborate on, in a single view, with their role indicated. | Must     |
| FR-LIST-6 | The system shall display a current item count per watchlist without requiring the client to fetch all items.           | Should   |

### 3.5 Watchlist Items

| ID        | Requirement                                                                                                   | Priority |
| :-------- | :------------------------------------------------------------------------------------------------------------ | :------- |
| FR-ITEM-1 | An Owner or Editor shall be able to add a film from TMDB to a watchlist.                                      | Must     |
| FR-ITEM-2 | The system shall prevent the same film being added twice to one watchlist.                                    | Must     |
| FR-ITEM-3 | An Owner or Editor shall be able to remove an item from a watchlist.                                          | Must     |
| FR-ITEM-4 | The system shall record which member added each item and when.                                                | Must     |
| FR-ITEM-5 | An Owner or Editor shall be able to reorder items within a watchlist.                                         | Should   |
| FR-ITEM-6 | The system shall render a watchlist's items without issuing one external request per item.                    | Must     |
| FR-ITEM-7 | A Viewer shall be able to read all items but modify none.                                                     | Must     |
| FR-ITEM-8 | The system shall support adding only films that exist in TMDB. Member-authored film entries are out of scope. | Must     |

### 3.6 Membership and Collaboration

| ID        | Requirement                                                                                                                                                                  | Priority |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-MEM-1  | The Owner shall be able to add a collaborator by username.                                                                                                                   | Must     |
| FR-MEM-2  | The system shall add collaborators immediately, without requiring the invitee to accept.                                                                                     | Must     |
| FR-MEM-3  | The Owner shall assign a role of Editor or Viewer when adding a collaborator, and shall be able to change it afterwards.                                                     | Must     |
| FR-MEM-4  | The Owner shall be able to remove any collaborator.                                                                                                                          | Must     |
| FR-MEM-5  | Any collaborator shall be able to remove themselves from a watchlist at any time.                                                                                            | Must     |
| FR-MEM-6  | The Owner shall not be able to leave or be removed from their own watchlist.                                                                                                 | Must     |
| FR-MEM-7  | The system shall enforce a maximum of 20 members per watchlist.                                                                                                              | Must     |
| FR-MEM-8  | A membership change shall update both the membership record and the watchlist's permission state as a single logical operation; partial application shall not be observable. | Must     |
| FR-MEM-9  | No member other than the Owner shall be able to alter the membership or permission state of a watchlist, including their own role.                                           | Must     |
| FR-MEM-10 | Username lookup shall return only public profile fields: username, display name, and avatar.                                                                                 | Must     |

### 3.7 Watched Tracking

| ID         | Requirement                                                                                                          | Priority |
| :--------- | :------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-WATCH-1 | A member shall be able to mark any item on a watchlist they can read as watched or unwatched.                        | Must     |
| FR-WATCH-2 | Watched state shall be recorded per member per item, independently of other members.                                 | Must     |
| FR-WATCH-3 | Every member of a watchlist shall see which members have marked each item as watched.                                | Must     |
| FR-WATCH-4 | The system shall display a member's own watched progress for a watchlist (e.g. 4 of 12).                             | Should   |
| FR-WATCH-6 | A member's watched mark shall survive their removal from the watchlist, attributed to an unidentified former member. | Should   |
| FR-WATCH-5 | Only the member themselves shall be able to set or clear their own watched mark.                                     | Must     |

### 3.8 Real-Time Synchronisation

| ID        | Requirement                                                                                                                                      | Priority |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-SYNC-1 | When a member has a watchlist open, item additions, removals, and reorderings made by other collaborators shall appear without a manual refresh. | Must     |
| FR-SYNC-2 | Real-time subscriptions shall be scoped to the watchlist currently open, not to every watchlist the member belongs to.                           | Must     |
| FR-SYNC-3 | The client shall unsubscribe when the member navigates away from a watchlist.                                                                    | Must     |
| FR-SYNC-4 | A member removed from a watchlist shall lose live updates for it.                                                                                | Must     |
| FR-SYNC-5 | On subscription interruption, the client shall reconcile by refetching, not by assuming continuity.                                              | Should   |

### 3.9 Film Data Integration

| ID        | Requirement                                                                                                                                                                                                                                                                             | Priority |
| :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| FR-TMDB-1 | All TMDB requests shall be issued server-side. The TMDB credential shall never be present in client-delivered code or network traffic.                                                                                                                                                  | Must     |
| FR-TMDB-2 | TMDB responses shall be cached server-side with expiry periods appropriate to volatility, and served from cache when unexpired.                                                                                                                                                         | Must     |
| FR-TMDB-3 | TMDB responses shall be normalised into application-defined types before reaching the client; TMDB's field naming shall not appear in the application's API contract.                                                                                                                   | Must     |
| FR-TMDB-4 | The system shall return relative image paths and allow the client to select an appropriate rendering size.                                                                                                                                                                              | Must     |
| FR-TMDB-5 | The system shall store a display snapshot alongside each film reference so that lists render from local data alone.                                                                                                                                                                     | Must     |
| FR-TMDB-6 | The system shall display TMDB attribution and logo as required by TMDB's terms of use.                                                                                                                                                                                                  | Must     |
| FR-TMDB-7 | On TMDB unavailability, the system shall continue to serve existing watchlists and saved films from stored snapshots, degrading only discovery and search.                                                                                                                              | Must     |
| FR-TMDB-8 | Poster and cast-photo image bytes shall be served from a domain the system controls, not directly from TMDB's image CDN, so that a network-level block on TMDB's CDN does not prevent members from viewing artwork. The system fetches from TMDB on a cache miss and caches the result. | Must     |

### 3.10 Presentation and Theme

| ID         | Requirement                                                                                                                     | Priority |
| :--------- | :------------------------------------------------------------------------------------------------------------------------------ | :------- |
| FR-THEME-1 | The system shall offer three appearance settings: light, dark, and follow system.                                               | Must     |
| FR-THEME-2 | The system shall default to following the operating system preference.                                                          | Must     |
| FR-THEME-3 | The system shall persist an explicit choice across sessions and devices-local storage.                                          | Must     |
| FR-THEME-4 | While set to follow system, the system shall track changes to the operating system preference without requiring a reload.       | Should   |
| FR-THEME-5 | The system shall apply the resolved theme before first paint, with no flash of the incorrect theme.                             | Must     |
| FR-THEME-6 | The appearance control shall be reachable from the authentication screens as well as from within the authenticated application. | Should   |

## 4\. External Interface Requirements

### 4.1 User Interface

- Responsive layout, 360px minimum viewport width
- Keyboard-navigable throughout; visible focus indicators
- Loading, empty, and error states defined for every data-backed view
- Optimistic UI on item add and remove, with rollback on failure

### 4.2 TMDB API

The sole external interface. Consumed server-side over HTTPS. Subject to TMDB's published rate limits and attribution obligations. Treated as untrusted input: responses are validated before storage or return.

## 5\. Non-Functional Requirements

### 5.1 Security

| ID        | Requirement                                                                                                                                                                                                                   |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-1 | Authorization shall be enforced server-side on every operation. Client-side checks are presentation only and shall never be the sole control.                                                                                 |
| NFR-SEC-2 | Permission-bearing fields shall be writable only by the Owner. No role shall be able to escalate its own privileges.                                                                                                          |
| NFR-SEC-3 | TMDB-backed operations shall be rate-limited per authenticated principal to prevent quota exhaustion. Authentication endpoints, as the only remaining unauthenticated surface, shall additionally be rate-limited per source. |
| NFR-SEC-4 | Permission revocation shall take effect within 30 seconds. A bounded window of continued read access after removal is accepted, justified by A-3, and shall be documented as a known limitation.                              |
| NFR-SEC-5 | Secrets shall be held in managed secret storage and injected at runtime. No secret shall appear in source control.                                                                                                            |
| NFR-SEC-6 | All traffic shall be over TLS.                                                                                                                                                                                                |
| NFR-SEC-7 | Member enumeration shall not be possible. Username lookup shall support exact match only, with no prefix search or listing.                                                                                                   |

### 5.2 Performance

| ID         | Requirement                                                                                      |
| :--------- | :----------------------------------------------------------------------------------------------- |
| NFR-PERF-1 | Discovery results shall render within 2 seconds on a warm cache, 4 seconds on a cold one.        |
| NFR-PERF-2 | Opening a watchlist shall require a bounded number of queries independent of item count.         |
| NFR-PERF-3 | Real-time updates shall reach connected collaborators within 3 seconds of the originating write. |
| NFR-PERF-4 | Initial JavaScript payload shall not exceed 300KB gzipped.                                       |

### 5.3 Reliability

| ID        | Requirement                                                                                       |
| :-------- | :------------------------------------------------------------------------------------------------ |
| NFR-REL-1 | Loss of TMDB availability shall not prevent authentication or access to stored data.              |
| NFR-REL-2 | Failed writes shall surface to the member; silent failure is not acceptable.                      |
| NFR-REL-3 | Deleting a watchlist shall not orphan its items, memberships, or watched records.                 |
| NFR-REL-4 | Removing an item from a watchlist shall not leave a watched record for it behind, for any member. |

### 5.4 Usability and Accessibility

| ID        | Requirement                                                                                                                                            |
| :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-USE-1 | The application shall meet WCAG 2.1 Level AA for colour contrast and keyboard operability.                                                             |
| NFR-USE-2 | A member's role on a watchlist shall be visible wherever it constrains what they can do.                                                               |
| NFR-USE-3 | Destructive actions — deleting a list, removing a collaborator — shall require confirmation.                                                           |
| NFR-USE-4 | Contrast requirements shall be satisfied independently in both light and dark themes. Compliance in one shall not be assumed from the other.           |
| NFR-USE-5 | Member identity colours shall carry equal perceived weight across hues and in both themes, and shall never be the sole means of conveying information. |
| NFR-USE-6 | Non-essential motion shall be suppressed when the operating system requests reduced motion.                                                            |

### 5.5 Compliance

| ID         | Requirement                                                                                                                |
| :--------- | :------------------------------------------------------------------------------------------------------------------------- |
| NFR-COMP-1 | TMDB attribution shall be present as required by their terms.                                                              |
| NFR-COMP-2 | Members shall be able to delete their account, removing their profile, saved films, watched records, and owned watchlists. |

## 6\. Verification

Authorization is the system's principal claim to correctness, and the area most likely to be probed by a reviewer. It requires explicit verification rather than incidental coverage.

### 6.1 Authorization Test Matrix

Every combination below shall have an automated test asserting allow or deny at the API layer, not the UI layer:

| Actor          | Read items | Add item | Remove item | Rename list | Change membership | Delete list | Toggle watched |
| :------------- | :--------- | :------- | :---------- | :---------- | :---------------- | :---------- | :------------- |
| Owner          | allow      | allow    | allow       | allow       | allow             | allow       | allow          |
| Editor         | allow      | allow    | allow       | allow       | deny              | deny        | allow          |
| Viewer         | allow      | deny     | deny        | deny        | deny              | deny        | allow          |
| Non-member     | deny       | deny     | deny        | deny        | deny              | deny        | deny           |
| Removed member | deny       | deny     | deny        | deny        | deny              | deny        | deny           |

"Toggle watched" is the one cell a Viewer may perform (FR-WATCH-1), and it is scoped to
the caller's own mark: setting or clearing anyone else's is denied to every actor
including the Owner (FR-WATCH-5, V-3).

### 6.2 Additional Verification Targets

| ID   | Target                                                                                                                                                     |
| :--- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Concurrent claims on the same username: exactly one succeeds.                                                                                              |
| V-2  | Revocation propagates fully within the NFR-SEC-4 window.                                                                                                   |
| V-3  | An Editor cannot set or clear another member's watched mark.                                                                                               |
| V-4  | Two clients on one watchlist observe each other's item changes live.                                                                                       |
| V-5  | The TMDB credential is absent from the client bundle and from all client-observable network traffic.                                                       |
| V-6  | Username lookup returns no email address under any input.                                                                                                  |
| V-7  | A partially failed membership change leaves no observable inconsistent state.                                                                              |
| V-8  | Automated contrast checks pass on every view in both light and dark themes.                                                                                |
| V-9  | Reordering a single item produces one write and one subscription event, independent of list length.                                                        |
| V-10 | Every TMDB-backed operation rejects an unauthenticated caller at the API layer. Asserted against the API directly, not by observing that the UI redirects. |

## 7\. Out of Scope

Deliberately excluded from this release. Each is a viable extension; none is required to satisfy the system's purpose.

- Ratings, reviews, and comments
- Recommendation engine
- Activity feeds and notifications
- Social graph — following, profiles, public list discovery
- Invitation by email address or shareable link
- Member-authored film entries not present in TMDB
- Aggregate watched state beyond per-item attribution — counts, leaderboards, "watched by everyone" rollups
- Offline support, PWA installation, native applications
- Television series, seasons, and episodes
- Internationalisation and localisation

## 8\. Open Items

Resolved in the System Design Document: state management, routing, module boundaries, code splitting and bundle allocation, cache design and expiry periods, and the permission fan-out mechanism.  
Still open:

- CI/CD pipeline, environment strategy, and branch model
- Observability: logging, metrics, error tracking, alarm thresholds
- Cost model at expected scale
- Visual design of individual screens, beyond the token system and layout principles
- Whether V-10 and NFR-SEC-3 require a carve-out for the image CDN introduced by
  FR-TMDB-8. Both were written before that requirement existed and neither was amended
  by v1.6: V-10 requires every TMDB-backed operation to reject an unauthenticated caller
  at the API layer, and NFR-SEC-3 treats the authentication endpoints as the only
  remaining unauthenticated surface — but artwork is now served from a public CloudFront
  distribution that satisfies neither. Either the two need an explicit exception for
  opaque public artwork (no user data crosses that path) or the surface needs closing.
  See System Design §10 for the partial mitigation applied in the meantime.
