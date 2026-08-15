import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';
import { claimHandle } from '../functions/claim-handle/resource';
import { tmdbProxy } from '../functions/tmdb-proxy/resource';

// Models below follow System Design §5.1 (Data Design) exactly. Before changing a
// key structure or auth rule, re-read §4.4 (Authorization Model) and ADR-001 — the
// composite keys and denormalised permission arrays are load-bearing, not incidental.
//
// STATUS: structural skeleton only. Field-level auth rules for the permission fields
// (§4.4 table) and the membershipFn custom-write path are NOT yet implemented — see
// TODOs inline. Do not ship this schema as-is; FR-MEM-9 depends on those rules existing.

const schema = a
    .schema({
        UserProfile: a
            .model({
                // id: Cognito sub (primary key, implicit)
                // Not .required(): post-confirmation (System Design §4.2) creates this row
                // at email verification, before the member has claimed a handle (FR-AUTH-3,
                // set during first-run onboarding via a separate owner update). A required
                // field here would make that create impossible.
                handle: a.string(),
                displayName: a.string(),
                avatarUrl: a.string(),
            })
            .authorization((allow) => [
                allow.authenticated().to(['read']),
                allow.owner().to(['read', 'update']),
                // FR-AUTH-7: email is intentionally NOT a field here — never expose it.
            ]),

        // Uniqueness sentinel for @handles (FR-AUTH-4, ADR-008). Conditional write
        // (attribute_not_exists) happens implicitly in claim-handle's Handle.create()
        // call — that's the standard behaviour of Amplify's generated create resolver
        // against this model's primary key, the handle string itself.
        Handle: a
            .model({
                handle: a.string().required(),
                userId: a.string().required(),
            })
            .identifier(['handle']) // load-bearing: without this, Amplify injects an
            // auto-generated `id` as the real primary key instead, and Handle.create()'s
            // conditional check becomes attribute_not_exists(id) — always true for a new
            // row, i.e. no uniqueness protection at all. FR-AUTH-4 / V-1 depend on `handle`
            // itself being the identifier.
            .authorization((allow) => [
                allow.authenticated().to(['read']),
                // No user-facing write rule exists on this model at all. The only writer
                // is claim-handle, via the schema-level allow.resource(claimHandle) grant
                // below — that's what makes it structurally the only writer, not discipline.
            ]),

        Watchlist: a
            .model({
                name: a.string().required(),
                description: a.string(),
                ownerId: a.string().required(),
                editors: a.string().array(),
                viewers: a.string().array(),
                itemCount: a.integer().default(0), // maintained by permission-fanout stream consumer, §5.4
            })
            .authorization((allow) => [
                allow.ownersDefinedIn('editors').to(['read', 'update']), // name/description only — see TODO below
                allow.ownersDefinedIn('viewers').to(['read']),
                allow.owner(), // full CRUD for the Owner
                // TODO (NFR-SEC-2 / FR-MEM-9 — do not skip): field-level write rules restricting
                // ownerId/editors/viewers to allow.resource(membershipFn) only. As written above,
                // allow.ownersDefinedIn('editors') grants editors update rights on the WHOLE
                // record, including editors/viewers themselves — that is a privilege escalation
                // hole. System Design §4.4 has the exact field/permission table to implement
                // via a custom mutation + field-level auth, not the generated update resolver.
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
                // Writes go through the membership function (TransactWriteItems, §4.2) — not
                // the generated resolver. Restrict create/update/delete to allow.resource(membershipFn).
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

        // FR-AUTH-3/4, ADR-008, V-1. success:false + error distinguishes the three
        // rejection reasons so the client doesn't have to parse GraphQL error strings
        // (System Design §2.5 — the client must handle server rejection gracefully
        // even after its own async availability check passed).
        ClaimHandleResult: a.customType({
            success: a.boolean().required(),
            handle: a.string(), // set only when success is true
            error: a.enum(['INVALID_FORMAT', 'ALREADY_CLAIMED', 'ALREADY_TAKEN']),
        }),
        claimHandle: a
            .mutation()
            .arguments({ handle: a.string().required() })
            .returns(a.ref('ClaimHandleResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(claimHandle)),
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
        // claim-handle reads UserProfile (to reject an already-claimed member),
        // creates Handle, and updates UserProfile.handle. Schema-level allow.resource()
        // operations are GraphQL-shaped ('query' | 'mutate' | 'listen'), not the
        // per-field CRUD vocabulary used inside a model's own .to() — 'query' covers
        // the UserProfile.get() read, same schema-wide-grant caveat as above.
        allow.resource(claimHandle).to(['mutate', 'query']),
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
