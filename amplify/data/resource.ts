import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';

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
        // (attribute_not_exists) happens in the claim-handle function, not here.
        Handle: a
            .model({
                handle: a.string().required(), // primary key
                userId: a.string().required(),
            })
            .authorization((allow) => [
                allow.authenticated().to(['read']),
                // Only the claim-handle function writes this table.
                // TODO: allow.resource(claimHandleFn) once the function resource exists.
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

        // TMDB proxy custom queries (System Design §6). All four are Lambda-backed and
        // authenticated-only under v1.1 — no guest access (ADR-009). Wire once tmdb-proxy exists:
        //   discoverMovies, searchMovies, getMovieDetails, getGenres
        // TODO: a.query(...).handler(a.handler.function(tmdbProxyFn)).authorization(allow => [allow.authenticated()])
        //       Note: allow.authenticated() only. allow.guest() would reopen the anonymous
        //       surface removed in ADR-009 and fail V-10.
    })
    .authorization((allow) => [
        // allow.resource(fn) is only available at schema level in the installed
        // @aws-amplify/data-schema — it can't be scoped to a single model or field
        // (ModelType/ModelField's authorization() callbacks omit `resource` from
        // the allow-modifier type). The IAM policy this grants post-confirmation
        // is schema-wide 'mutate', wider than "create on UserProfile only"; the
        // handler itself only ever calls UserProfile.create. When claimHandleFn and
        // membershipFn land, their grants join this same list.
        allow.resource(postConfirmation).to(['mutate']),
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
