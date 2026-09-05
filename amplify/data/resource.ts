import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';
import { claimUsername } from '../functions/claim-username/resource';
import { tmdbProxy } from '../functions/tmdb-proxy/resource';
import { membership } from '../functions/membership/resource';

// Models below follow System Design §5.1 (Data Design) exactly. Before changing a
// key structure or auth rule, re-read §4.4 (Authorization Model) and ADR-001 — the
// composite keys and denormalised permission arrays are load-bearing, not incidental.
//
// STATUS: FR-MEM-9's field-level auth (Watchlist's ownerId/editors/viewers), the
// membership function (addMember/removeMember/leaveWatchlist), and permission-fanout
// (§4.5 propagation to WatchlistItem + §5.4 itemCount maintenance, both stream-driven
// from amplify/backend.ts — not visible in this file) are all implemented. All five
// functions named in System Design §4.1 now exist.

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
                username: a.string(),
                displayName: a.string(),
                avatarUrl: a.string(),
            })
            .authorization((allow) => [
                allow.authenticated().to(['read']),
                allow.owner().to(['read', 'update']),
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
                allow.authenticated().to(['read']),
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
                // structurally unreachable from any GraphQL request, full stop. `create` stays
                // granted to the Owner only, so the initial values can be set when a watchlist
                // is made.
                ownerId: a
                    .string()
                    .required()
                    .authorization((allow) => [
                        allow.owner().to(['read', 'create']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                editors: a
                    .string()
                    .array()
                    .authorization((allow) => [
                        allow.owner().to(['read', 'create']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                viewers: a
                    .string()
                    .array()
                    .authorization((allow) => [
                        allow.owner().to(['read', 'create']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
                itemCount: a.integer().default(0), // maintained by permission-fanout stream consumer, §5.4
            })
            .authorization((allow) => [
                // Model-level default, applying to every field WITHOUT its own rule above —
                // i.e. name/description only, per §4.4's table.
                allow.ownersDefinedIn('editors').to(['read', 'update']),
                allow.ownersDefinedIn('viewers').to(['read']),
                allow.owner(), // full CRUD on name/description; ownerId/editors/viewers narrowed above
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
                allow.ownersDefinedIn('editors'), // full CRUD
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
    })
    .authorization((allow) => [
        // allow.resource(fn) is only available at schema level in the installed
        // @aws-amplify/data-schema — it can't be scoped to a single model or field
        // (ModelType/ModelField's authorization() callbacks omit `resource` from
        // the allow-modifier type). The IAM policy this grants post-confirmation
        // is schema-wide 'mutate', wider than "create on UserProfile only"; the
        // handler itself only ever calls UserProfile.create. When membershipFn
        // lands, its grant joins this same list.
        allow.resource(postConfirmation).to(['mutate']),
        // claim-username reads UserProfile (to reject an already-claimed member),
        // creates Username, and updates UserProfile.username. Schema-level allow.resource()
        // operations are GraphQL-shaped ('query' | 'mutate' | 'listen'), not the
        // per-field CRUD vocabulary used inside a model's own .to() — 'query' covers
        // the UserProfile.get() read, same schema-wide-grant caveat as above.
        allow.resource(claimUsername).to(['mutate', 'query']),
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
