import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';
import { claimUsername } from '../functions/claim-username/resource';
import { tmdbProxy } from '../functions/tmdb-proxy/resource';
import { membership } from '../functions/membership/resource';
import { deleteAccount } from '../functions/delete-account/resource';
import { watchlistItem } from '../functions/watchlist-item/resource';
import { toggleWatched } from '../functions/toggle-watched/resource';

const schema = a
    .schema({
        UserProfile: a
            .model({
                // Optional: post-confirmation creates the bare row, the username is
                // claimed afterwards. Readable by any member, writable by no one over
                // GraphQL — claim-username writes it via DynamoDB (see backend.ts).
                username: a.string().authorization((allow) => [allow.authenticated().to(['read'])]),
                displayName: a.string(),
                avatarUrl: a.string(),
            })
            .authorization((allow) => [
                // `get`, not `read`: `read` would also generate listUserProfiles.
                allow.authenticated().to(['get']),
                // Ownership rides on `id` (the Cognito sub). The default owner() rule
                // relies on a separate field Amplify auto-populates only on a userPool
                // write — post-confirmation creates this row over IAM, so that field
                // would stay empty and every later owner write would be denied.
                allow.ownerDefinedIn('id').identityClaim('sub').to(['get', 'update']),
            ]),

        // Uniqueness sentinel for usernames. The claim is the implicit
        // attribute_not_exists condition on this model's primary key.
        Username: a
            .model({
                username: a.string().required(),
                userId: a.string().required(),
            })
            // Load-bearing: without it Amplify injects an auto-generated `id` as the
            // real key and the conditional check becomes attribute_not_exists(id),
            // which is true for every new row.
            .identifier(['username'])
            .authorization((allow) => [
                // `get`, not `read`: `read` would also generate listUsernames.
                allow.authenticated().to(['get']),
                // No write rule: claim-username is the only writer, via the
                // schema-level allow.resource() grant below.
            ]),

        Watchlist: a
            .model({
                name: a.string().required(),
                description: a.string(),
                // A field's own .authorization() replaces the model-level rules for
                // that field. ownerId/editors/viewers/itemCount get no `update` grant
                // at all, so no caller can reach them over GraphQL; their writers go
                // straight to DynamoDB. `create` survives only on ownerId, which has
                // to be set when the list is made.
                ownerId: a
                    .string()
                    .required()
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read', 'create']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
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
                // No .default(0), deliberately: field-level authorization is checked
                // against the mutation's write set, and a default puts the field in
                // that set even when the caller never sent it — which would fail every
                // create with "Unauthorized on [itemCount]". Nothing depends on the 0;
                // DynamoDB's ADD treats a missing number as 0 and both readers coalesce.
                itemCount: a
                    .integer()
                    .authorization((allow) => [
                        allow.ownerDefinedIn('ownerId').identityClaim('sub').to(['read']),
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
            })
            .authorization((allow) => [
                // Applies to name/description only — every other field has its own rule.
                allow.ownersDefinedIn('editors').to(['read', 'update']),
                allow.ownersDefinedIn('viewers').to(['read']),
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
                // No write grant for anyone: the membership function writes this table
                // directly via TransactWriteItems, not through AppSync.
                allow.authenticated().to(['read']),
            ]),

        WatchlistItem: a
            .model({
                watchlistId: a.string().required(),
                tmdbId: a.string().required(),
                // Snapshot, so lists render without an external call.
                title: a.string().required(),
                posterPath: a.string(),
                releaseYear: a.integer(),
                addedBy: a.string().required(),
                addedAt: a.datetime(),
                position: a.string().required(), // fractional rank — string, not float
                // Denormalised from the parent Watchlist, kept in sync by permission-fanout.
                editors: a.string().array(),
                viewers: a.string().array(),
                // A field's own rule replaces the model-level ones for that field: read
                // for every member, `update` for nobody. toggle-watched is the only
                // writer, over direct DynamoDB. See System Design §4.4 and ADR-014.
                watchedBy: a
                    .string()
                    .array()
                    .authorization((allow) => [
                        allow.ownersDefinedIn('editors').to(['read']),
                        allow.ownersDefinedIn('viewers').to(['read']),
                    ]),
            })
            .identifier(['watchlistId', 'tmdbId'])
            .authorization((allow) => [
                // No `create`: a generated create resolver can only check the editors
                // array the caller just sent, so any member could insert into any list
                // by naming its id. Creation goes through addWatchlistItem below, which
                // reads the parent. update/delete are safe — they check this item's
                // fan-out-maintained array, which is no longer forgeable.
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
            .identifier(['userId', 'tmdbId'])
            .secondaryIndexes((index) => [index('userId').name('byUserAndDate').sortKeys(['savedAt'])])
            .authorization((allow) => [allow.owner()]),

        Genre: a.customType({
            id: a.integer().required(),
            name: a.string().required(),
        }),
        MovieSummary: a.customType({
            tmdbId: a.string().required(),
            title: a.string().required(),
            posterPath: a.string(), // relative path — the client picks w185/w500
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
        // Trending and genre-filtered discovery are one query — the handler branches
        // on whether genreIds is present.
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

        // success:false + error distinguishes the rejection reasons so the client
        // doesn't have to parse GraphQL error strings.
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

        // The arguments carry no permission data and no attribution: editors/viewers
        // come from the parent Watchlist, addedBy from the caller's sub, addedAt from
        // the server clock. allow.authenticated() is a coarse gate; the Owner-or-Editor
        // check happens in the handler against the parent row it reads itself.
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

        ToggleWatchedResult: a.customType({
            success: a.boolean().required(),
            error: a.enum(['NOT_FOUND', 'NOT_ALLOWED', 'CONFLICT']),
        }),
        // allow.authenticated() is a coarse gate; the handler reads the item server-side
        // and checks the caller against its editors/viewers arrays.
        toggleWatched: a
            .mutation()
            .arguments({
                watchlistId: a.string().required(),
                tmdbId: a.string().required(),
                watched: a.boolean().required(),
            })
            .returns(a.ref('ToggleWatchedResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(toggleWatched)),

        // The membership mutations share one Lambda. allow.authenticated() is a coarse
        // gate; the owner/self checks happen inside the handler.
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
        // Shared by removeMember and leaveWatchlist — both remove a single membership
        // record, differing only in who may call them.
        MembershipResult: a.customType({
            success: a.boolean().required(),
            error: a.enum(['NOT_FOUND', 'NOT_OWNER', 'NOT_A_MEMBER', 'CANNOT_REMOVE_OWNER', 'CONFLICT']),
        }),

        addMember: a
            .mutation()
            .arguments({
                watchlistId: a.string().required(),
                username: a.string().required(),
                // a.enum() has no .required() modifier; the handler validates presence.
                role: a.enum(['EDITOR', 'VIEWER']),
            })
            .returns(a.ref('AddMemberResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        removeMember: a
            .mutation()
            .arguments({ watchlistId: a.string().required(), userId: a.string().required() })
            .returns(a.ref('MembershipResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

        leaveWatchlist: a
            .mutation()
            .arguments({ watchlistId: a.string().required() })
            .returns(a.ref('MembershipResult'))
            .authorization((allow) => [allow.authenticated()])
            .handler(a.handler.function(membership)),

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

        // No arguments and no error enum: deleteAccount only ever acts on
        // event.identity.sub, so it is self-scoped by construction.
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
        // allow.resource() exists only at schema level in the installed
        // @aws-amplify/data-schema, and its operations are GraphQL-shaped
        // ('query' | 'mutate' | 'listen'). Every grant here is therefore schema-wide
        // 'mutate' even though each handler touches exactly one model.
        allow.resource(postConfirmation).to(['mutate']),
        // claim-username's remaining AppSync calls are Username.create() (whose
        // implicit attribute_not_exists condition is the uniqueness mechanism) and
        // the compensating Username.delete().
        allow.resource(claimUsername).to(['mutate']),
        // watchlist-item creates through AppSync deliberately: that is what publishes
        // the onCreateWatchlistItem subscription event /lists/:id depends on.
        allow.resource(watchlistItem).to(['mutate']),
    ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool',
    },
});
