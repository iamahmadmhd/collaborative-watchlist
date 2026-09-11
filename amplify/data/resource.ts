import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';
import { claimUsername } from '../functions/claim-username/resource';
import { tmdbProxy } from '../functions/tmdb-proxy/resource';
import { membership } from '../functions/membership/resource';
import { deleteAccount } from '../functions/delete-account/resource';
import { watchlistItem } from '../functions/watchlist-item/resource';

// Models below follow System Design §5.1 (Data Design) exactly. Before changing a
// key structure or auth rule, re-read §4.4 (Authorization Model) and ADR-001 — the
// composite keys and denormalised permission arrays are load-bearing, not incidental.
//
// STATUS: FR-MEM-9's field-level auth (Watchlist's ownerId/editors/viewers), the
// membership function (addMember/removeMember/leaveWatchlist), and permission-fanout
// (§4.5 propagation to WatchlistItem + §5.4 itemCount maintenance, both stream-driven
// from amplify/backend.ts — not visible in this file) are all implemented. All five
// functions named in System Design §4.1 now exist, plus three §4.1 does not name:
// delete-account (NFR-COMP-2), image-proxy (FR-TMDB-8, ADR-013 — not schema-referenced
// at all), and watchlist-item, which exists because the generated create resolver
// cannot authorize a WatchlistItem against its parent Watchlist — see that model's
// authorization comment below.

const schema = a
    .schema({
        UserProfile: a
            .model({
                // id: Cognito sub (primary key, implicit)
                // Not .required(): post-confirmation (System Design §4.2) only ever
                // creates the bare row (ADR-011, v1.4) — the username is claimed
                // afterward, authenticated, via claim-username (the post-verification
                // username screen, or Settings for a member who abandoned that screen).
                // This field stays optional to cover the window between those two steps.
                // Field-level authorization REPLACES the model-level rules for this
                // field (same Amplify Gen2 semantics the Watchlist model relies on
                // below): readable by any authenticated member, writable by NO ONE
                // through GraphQL — not even its owner. Without this, the model-level
                // owner `update` grant covered it, and
                // `UserProfile.update({ id: me, username: 'someone_else' })` let any
                // member display a handle they never claimed. That bypasses
                // claim-username's Username-sentinel write entirely, so the handle
                // isn't globally taken — but the handle every screen renders is this
                // field, which is the impersonation that matters (FR-AUTH-4,
                // NFR-SEC-7). claim-username still writes it, via a direct DynamoDB
                // UpdateItem rather than through AppSync — see that handler, and the
                // schema-level allow.resource() comment at the bottom of this file,
                // for why a field-level rule can't name a function grant.
                username: a.string().authorization((allow) => [allow.authenticated().to(['read'])]),
                displayName: a.string(),
                avatarUrl: a.string(),
            })
            .authorization((allow) => [
                // NFR-SEC-7 ("Member enumeration shall not be possible"): `read`
                // grants BOTH get and list, so this previously exposed
                // `listUserProfiles` — the entire member directory, to any signed-in
                // caller. `get` keeps the point reads every caller actually makes
                // (entities/member's use-current-user, use-watchlist-members' display
                // -name lookup) and removes the list query from the schema altogether.
                allow.authenticated().to(['get']),
                // ownerDefinedIn('id') rather than the default owner() (which would add
                // and rely on a SEPARATE auto-populated `owner` field): default owner
                // auth's auto-population only runs on a genuine userPool-authenticated
                // write, but post-confirmation creates this row over IAM
                // (allow.resource() below) — that auto-population never fires, so a
                // separate `owner` field would stay permanently empty and every later
                // owner-authenticated update() would be silently denied (the original
                // form of this bug: display name never persisted). `id` has no such
                // problem — it's the Cognito sub, and every writer (this create,
                // claim-username's later update) already sets it correctly as a matter
                // of course, so pointing ownership at it needs no extra field, no extra
                // write, and no extra IAM grant. identityClaim('sub') matches the same
                // bare claim against it (default owner() would compare against the
                // composite `sub::cognito:username` claim instead — moot here anyway,
                // since auth/resource.ts's email+OTP login has no real Cognito username
                // to compose with).
                allow.ownerDefinedIn('id').identityClaim('sub').to(['get', 'update']),
                // FR-AUTH-7: email is intentionally NOT a field here — never expose it.
            ]),

        // Uniqueness sentinel for @usernames (FR-AUTH-4, ADR-008). Conditional write
        // (attribute_not_exists) happens implicitly in claim-username's Username.create()
        // call — that's the standard behaviour of Amplify's generated create resolver
        // against this model's primary key, the username string itself. Read directly
        // (allow.authenticated below) by the username screen's live-availability check
        // (System Design §2.5, ADR-011) — no separate query resolver needed for that.
        Username: a
            .model({
                username: a.string().required(),
                userId: a.string().required(),
            })
            .identifier(['username']) // load-bearing: without this, Amplify injects an
            // auto-generated `id` as the real primary key instead, and Username.create()'s
            // conditional check becomes attribute_not_exists(id) — always true for a new
            // row, i.e. no uniqueness protection at all. FR-AUTH-4 / V-1 depend on `username`
            // itself being the identifier.
            .authorization((allow) => [
                // `get`, not `read`. NFR-SEC-7 requires exact-match lookup with no
                // listing, and System Design §7.1 names that as the mechanism — but
                // `read` grants get AND list, so `listUsernames` handed any
                // authenticated caller every username -> userId pair in the system.
                // Restricting to `get` removes that query from the generated schema,
                // leaving only the point read the live-availability check needs.
                allow.authenticated().to(['get']),
                // No user-facing write rule exists on this model at all. The only writer
                // is claim-username, via the schema-level allow.resource(claimUsername) grant
                // below — that's what makes it structurally the only writer, not discipline.
            ]),

        Watchlist: a
            .model({
                name: a.string().required(),
                description: a.string(),
                // Field-level authorization below REPLACES the model-level rules for these
                // three fields only (Amplify Gen2 Data semantics — a field's own .authorization()
                // is exclusive, not additive, for that field; every other field keeps inheriting
                // the model-level rules at the bottom of this model). System Design §4.4's table
                // says these three are "allow.resource(membershipFn) only" — but membershipFn
                // (amplify/functions/membership) never calls back through AppSync at all: FR-MEM-8
                // requires an atomic write across Watchlist AND WatchlistMember, and AppSync/
                // Amplify Data has no transactional multi-model mutation, so membership talks to
                // DynamoDB directly via TransactWriteItems (IAM grant in backend.ts), bypassing
                // the GraphQL API entirely. allow.resource() grants a Lambda access *through*
                // AppSync — irrelevant to a function that never goes through it. The correct
                // closure of FR-MEM-9 / NFR-SEC-2 on the GraphQL surface is therefore stronger
                // than allow.resource() would have been: no caller — Owner included — gets
                // `update` on these fields via the API at all, so post-creation they are
                // structurally unreachable from any GraphQL request, full stop. Of the three,
                // only `ownerId` keeps a `create` grant — it has to be set when a watchlist is
                // made; editors/viewers start empty and belong to the membership function.
                //
                // ownerId IS this model's ownership field (see the model-level rule
                // below), not just a string the Owner happens to be allowed to write.
                // That distinction was the bug: under the previous `allow.owner()`,
                // ownership rode on a SEPARATE implicit `owner` field that Amplify
                // auto-populates from the caller's claim, while `ownerId` stayed an
                // ordinary client-supplied string with no constraint on its VALUE. A
                // member could therefore create a watchlist carrying someone else's
                // sub as ownerId: permission-fanout's INSERT handler then wrote a
                // WatchlistMember(OWNER) row for that victim, the list appeared on
                // their /lists screen, and membership/handler.ts's
                // `watchlist.ownerId === callerId` check handed them administration of
                // a list the planter could still rename and delete. Pointing the
                // model's owner rule at `ownerId` makes Amplify validate the field
                // against the caller's own sub on create (and populate it when
                // omitted), which is the check that was missing. `update` is granted to
                // no one, so ownership is write-once (FR-MEM-9 / NFR-SEC-2).
                ownerId: a
                    .string()
                    .required()
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read', 'create']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                // Read-only to everyone, including the Owner: `create` is gone as well
                // as `update`. Nothing sets these at creation time — §4.4 makes the
                // membership function their sole writer — and leaving `create` granted
                // let an Owner seed a list with arbitrary collaborators, skipping the
                // WatchlistMember rows FR-MEM-8 pairs them with and the 20-member cap
                // FR-MEM-7 sets.
                editors: a
                    .string()
                    .array()
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                viewers: a
                    .string()
                    .array()
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                // Maintained by the permission-fanout stream consumer (§5.4), which
                // writes it straight to DynamoDB — so, like the three fields above, it
                // needs no GraphQL write path at all. It previously had none of its own
                // rules and so inherited the model-level Editor `update` grant, letting
                // any Editor set the list's film count to whatever they liked.
                itemCount: a
                    .integer()
                    .default(0)
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
            })
            .authorization((allow) => [
                // Model-level default, applying to every field WITHOUT its own rule above —
                // i.e. name/description only, per §4.4's table.
                allow.ownersDefinedIn('editors').to(['read', 'update']),
                allow.ownersDefinedIn('viewers').to(['read']),
                // Ownership rides on `ownerId` (see that field's comment) rather than a
                // separate implicit `owner` field. Full CRUD on name/description;
                // ownerId/editors/viewers/itemCount narrowed above.
                allow.ownerDefinedIn('ownerId').identityClaim('sub'),
            ]),

        WatchlistMember: a
            .model({
                watchlistId: a.string().required(),
                userId: a.string().required(),
                role: a.enum(['OWNER', 'EDITOR', 'VIEWER']),
                joinedAt: a.datetime(),
            })
            .identifier(['watchlistId', 'userId'])
            .secondaryIndexes((index) => [index('userId').name('byUser')])
            .authorization((allow) => [
                allow.authenticated().to(['read']),
                // No create/update/delete grant exists here for anyone — this model already has
                // zero user-facing write path via GraphQL. Writes come exclusively from the
                // membership function (amplify/functions/membership), which writes this table
                // directly via DynamoDB TransactWriteItems under an IAM grant (backend.ts), not
                // through AppSync — see the Watchlist model's comment above for why
                // allow.resource() isn't the mechanism here (no transactional multi-model
                // mutation exists to grant access to in the first place).
            ]),

        WatchlistItem: a
            .model({
                watchlistId: a.string().required(),
                tmdbId: a.string().required(),
                // Snapshot (FR-TMDB-5) — denormalised so lists render without an external call.
                title: a.string().required(),
                posterPath: a.string(),
                releaseYear: a.integer(),
                addedBy: a.string().required(),
                addedAt: a.datetime(),
                position: a.string().required(), // fractional rank, ADR-006 — string, not float
                // Denormalised from parent Watchlist, kept in sync by permission-fanout (§4.5, ADR-001).
                editors: a.string().array(),
                viewers: a.string().array(),
            })
            .identifier(['watchlistId', 'tmdbId']) // composite key => FR-ITEM-2 (no dup) is free
            .authorization((allow) => [
                // No `create` for anyone. `allow.ownersDefinedIn('editors')` can only
                // check that the caller appears in the array the caller just sent, and
                // `watchlistId` is likewise part of the create input — so under a
                // client-facing create grant ANY authenticated member could insert an
                // item into ANY watchlist by naming its id and listing themselves (plus
                // whoever else they liked) in `editors`. Nothing in the generated
                // resolver could consult the parent Watchlist to know better. Creation
                // now goes through the addWatchlistItem mutation below, whose handler
                // reads the parent, checks Owner-or-Editor, and stamps these arrays
                // itself (SRS §6.1's "Non-member -> add item: deny" cell).
                //
                // `update`/`delete` stay client-facing: both require the caller to
                // already be in THIS item's fan-out-maintained editors array, which is
                // no longer forgeable now that items can't be created with one.
                allow.ownersDefinedIn('editors').to(['read', 'update', 'delete']),
                allow.ownersDefinedIn('viewers').to(['read']),
            ]),

        SavedMovie: a
            .model({
                userId: a.string().required(),
                tmdbId: a.string().required(),
                title: a.string().required(),
                posterPath: a.string(),
                releaseYear: a.integer(),
                savedAt: a.datetime(),
            })
            .identifier(['userId', 'tmdbId']) // composite key => double-save prevention free
            .secondaryIndexes((index) => [index('userId').name('byUserAndDate').sortKeys(['savedAt'])])
            .authorization((allow) => [
                allow.owner(), // FR-SAVE-4: private, visible to no one else
            ]),

        WatchStatus: a
            .model({
                userId: a.string().required(),
                itemId: a.string().required(),
                watchlistId: a.string().required(),
                watchedAt: a.datetime(),
            })
            .identifier(['userId', 'itemId'])
            .secondaryIndexes((index) => [index('userId').sortKeys(['watchlistId']).name('byUserAndList')])
            .authorization((allow) => [
                allow.owner(), // V-3: a Viewer's watched state is invisible to the Owner
            ]),

        // TMDB proxy custom queries (System Design §6, ADR-007). All four are
        // Lambda-backed and authenticated-only under v1.1 — no guest access (ADR-009).
        // allow.authenticated() only: allow.guest() would reopen the anonymous surface
        // removed in ADR-009 and fail V-10.
        Genre: a.customType({
            id: a.integer().required(),
            name: a.string().required(),
        }),
        MovieSummary: a.customType({
            tmdbId: a.string().required(),
            title: a.string().required(),
            posterPath: a.string(), // relative path (FR-TMDB-4) — client picks w185/w500
            releaseYear: a.integer(),
        }),
        CastMember: a.customType({
            tmdbId: a.string().required(),
            name: a.string().required(),
            character: a.string(),
            profilePath: a.string(),
        }),
        MovieDetail: a.customType({
            tmdbId: a.string().required(),
            title: a.string().required(),
            overview: a.string(),
            releaseDate: a.string(),
            runtimeMinutes: a.integer(),
            posterPath: a.string(),
            genres: a.ref('Genre').array(),
            cast: a.ref('CastMember').array(),
        }),
        PaginatedMovies: a.customType({
            results: a.ref('MovieSummary').array().required(),
            page: a.integer().required(),
            totalPages: a.integer().required(),
            totalResults: a.integer().required(),
        }),

        getGenres: a
            .query()
            .arguments({})
            .returns(a.ref('Genre').array())
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(tmdbProxy)),
        // FR-DISC-1 (trending/popular, no filter) and FR-DISC-3 (genre filter) are one
        // query — see handler.ts for the trending/discover branch on genreIds presence.
        discoverMovies: a
            .query()
            .arguments({ genreIds: a.integer().array(), page: a.integer() })
            .returns(a.ref('PaginatedMovies'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(tmdbProxy)),
        searchMovies: a
            .query()
            .arguments({ query: a.string().required(), page: a.integer() })
            .returns(a.ref('PaginatedMovies'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(tmdbProxy)),
        getMovieDetails: a
            .query()
            .arguments({ tmdbId: a.string().required() })
            .returns(a.ref('MovieDetail'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(tmdbProxy)),

        // FR-AUTH-3/4, ADR-008, V-1, ADR-011. success:false + error distinguishes the
        // three rejection reasons so the client doesn't have to parse GraphQL error
        // strings (System Design §2.5 — the client must handle server rejection
        // gracefully even after its own live-availability check passed). As of v1.4
        // this is the primary path again, called from the post-verification username
        // screen (authenticated by then); Settings calls the same mutation as the
        // recovery path for a member who verified but never finished that screen.
        // ALREADY_CLAIMED is what keeps it first-claim-only.
        ClaimUsernameResult: a.customType({
            success: a.boolean().required(),
            username: a.string(), // set only when success is true
            error: a.enum(['INVALID_FORMAT', 'ALREADY_CLAIMED', 'ALREADY_TAKEN']),
        }),
        claimUsername: a
            .mutation()
            .arguments({ username: a.string().required() })
            .returns(a.ref('ClaimUsernameResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(claimUsername)),

        // FR-ITEM-1/2/4, ADR-001. Item creation is a Lambda-backed mutation rather
        // than the generated createWatchlistItem resolver — see the WatchlistItem
        // model's authorization comment above for the hole that closes, and
        // functions/watchlist-item/resource.ts for why the handler still performs
        // its write back through AppSync (subscriptions, §2.4) instead of writing
        // DynamoDB directly the way membership and delete-account do.
        //
        // The argument list deliberately carries no permission data and no
        // attribution: editors/viewers come from the parent Watchlist, addedBy from
        // the caller's Cognito sub, addedAt from the server clock. `position` is the
        // client-computed fractional rank (ADR-006) and authorizes nothing.
        // allow.authenticated() is a coarse gate only; the Owner-or-Editor check
        // happens inside the handler against the parent row it reads itself
        // (NFR-SEC-1), matching claimUsername's and membership's pattern.
        AddWatchlistItemResult: a.customType({
            success: a.boolean().required(),
            error: a.enum(['NOT_FOUND', 'NOT_ALLOWED', 'ALREADY_IN_LIST']),
        }),
        addWatchlistItem: a
            .mutation()
            .arguments({
                watchlistId: a.string().required(),
                tmdbId: a.string().required(),
                title: a.string().required(),
                posterPath: a.string(),
                releaseYear: a.integer(),
                position: a.string().required(),
            })
            .returns(a.ref('AddWatchlistItemResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(watchlistItem)),

        // membership (System Design §4.2, §4.4, §4.5, FR-MEM-1..9). All three mutations are
        // handled by the same Lambda, which writes Watchlist + WatchlistMember atomically via
        // DynamoDB TransactWriteItems — see membership/handler.ts for why. allow.authenticated()
        // here is a coarse gate only; the actual owner/self checks happen inside the handler
        // against data it reads itself, matching claimUsername's pattern (NFR-SEC-1 — server-side
        // enforcement, not the mutation-level auth rule).
        AddMemberResult: a.customType({
            success: a.boolean().required(),
            error: a.enum([
                'NOT_FOUND',
                'NOT_OWNER',
                'INVALID_ROLE',
                'USERNAME_NOT_FOUND',
                'ALREADY_MEMBER',
                'MEMBER_CAP_REACHED',
                'CONFLICT',
            ]),
        }),
        // Shared by removeMember and leaveWatchlist — both a single membership record's
        // removal, differing only in who may call them and whether NOT_OWNER can occur.
        MembershipResult: a.customType({
            success: a.boolean().required(),
            error: a.enum(['NOT_FOUND', 'NOT_OWNER', 'NOT_A_MEMBER', 'CANNOT_REMOVE_OWNER', 'CONFLICT']),
        }),

        // FR-MEM-1/3: Owner adds a collaborator by username, assigning Editor or Viewer.
        addMember: a
            .mutation()
            .arguments({
                watchlistId: a.string().required(),
                username: a.string().required(),
                // Not .required() — a.enum() doesn't support the modifier (matches the
                // ClaimUsernameResult.error / WatchlistMember.role style elsewhere in this file).
                // Handler validates presence at runtime instead.
                role: a.enum(['EDITOR', 'VIEWER']),
            })
            .returns(a.ref('AddMemberResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        // FR-MEM-4: Owner removes any collaborator (never the Owner themselves — FR-MEM-6).
        removeMember: a
            .mutation()
            .arguments({ watchlistId: a.string().required(), userId: a.string().required() })
            .returns(a.ref('MembershipResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        // FR-MEM-5: any collaborator removes themselves (the Owner cannot — FR-MEM-6).
        leaveWatchlist: a
            .mutation()
            .arguments({ watchlistId: a.string().required() })
            .returns(a.ref('MembershipResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        // FR-MEM-3's second clause ("and shall be able to change it afterwards"). Same
        // Lambda, same transactional editors/viewers <-> WatchlistMember.role pattern as
        // addMember/removeMember — see membership/handler.ts's changeMemberRole.
        ChangeRoleResult: a.customType({
            success: a.boolean().required(),
            error: a.enum([
                'NOT_FOUND',
                'NOT_OWNER',
                'INVALID_ROLE',
                'NOT_A_MEMBER',
                'CANNOT_CHANGE_OWNER',
                'CONFLICT',
            ]),
        }),
        changeMemberRole: a
            .mutation()
            .arguments({
                watchlistId: a.string().required(),
                userId: a.string().required(),
                role: a.enum(['EDITOR', 'VIEWER']),
            })
            .returns(a.ref('ChangeRoleResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        // NFR-COMP-2. No arguments and no error enum: unlike addMember/removeMember/
        // changeMemberRole, there is no target to get wrong and no ownership/self check to
        // fail — deleteAccount only ever acts on event.identity.sub, so it's inherently
        // self-scoped by construction, not by a runtime check. allow.authenticated() is the
        // same coarse gate the other membership-style mutations use; the handler's actual
        // writes go straight to DynamoDB (delete-account/handler.ts), same reason as
        // membership's own mutations bypass the generated resolvers.
        DeleteAccountResult: a.customType({
            success: a.boolean().required(),
        }),
        deleteAccount: a
            .mutation()
            .arguments({})
            .returns(a.ref('DeleteAccountResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(deleteAccount)),
    })
    .authorization((allow) => [
        // allow.resource(fn) is only available at schema level in the installed
        // @aws-amplify/data-schema — it can't be scoped to a single model or field
        // (ModelType/ModelField's authorization() callbacks omit `resource` from
        // the allow-modifier type). The IAM policy this grants post-confirmation
        // is schema-wide 'mutate', wider than "create on UserProfile only"; the
        // handler itself only ever calls UserProfile.create.
        //
        // This is also the one mechanism here safe from a stack-topology trap:
        // post-confirmation is grouped into the AUTH stack (its resource.ts —
        // required for the Cognito trigger wiring in auth/resource.ts), and the
        // data stack already depends on the auth stack one way (defineData's
        // userPool authorization mode needs the User Pool as its authorizer).
        // allow.resource(fn) only ever points data-stack -> fn's-stack, so it
        // stacks harmlessly on top of that same-direction dependency; backend.ts
        // has the fuller comment on why a plain CDK Table.grant() the other way
        // (data-stack table -> auth-stack function) isn't safe to add instead.
        //
        // Schema-level allow.resource() operations are GraphQL-shaped
        // ('query' | 'mutate' | 'listen'), not the per-field CRUD vocabulary used
        // inside a model's own .to(), and they cannot be narrowed to a single model or
        // field — every grant below is schema-wide 'mutate' even though each handler
        // touches exactly one model.
        allow.resource(postConfirmation).to(['mutate']),
        // Narrowed from ['mutate', 'query']: claim-username's only remaining AppSync
        // calls are Username.create() (whose implicit attribute_not_exists condition
        // is the actual uniqueness mechanism, ADR-008) and the compensating
        // Username.delete(). Its UserProfile read and its UserProfile.username write
        // now go straight to DynamoDB — they had to, because that field carries its
        // own field-level rule and, as the paragraph above explains, allow.resource()
        // has no field-level form to name there.
        allow.resource(claimUsername).to(['mutate']),
        // watchlist-item calls WatchlistItem.create() through AppSync, deliberately:
        // that is what publishes the onCreateWatchlistItem subscription event
        // /lists/:id depends on (§2.4). Same schema-wide-grant caveat as above — the
        // handler only ever calls that one mutation.
        allow.resource(watchlistItem).to(['mutate']),
    ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool',
        // userPool is the ONLY client-facing mode (System Design §4.3, v1.1). There is
        // deliberately no identityPool/guest mode — see ADR-009.
    },
});
