import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '$amplify/env/watchlist-item';
import type { Schema } from '../../data/resource';

// Creates a WatchlistItem. See resource.ts for why this function exists and why the
// parent read and the write take different paths (raw DynamoDB in, AppSync out).
//
// Everything security-relevant is derived here, never taken from the request:
// editors/viewers from the parent Watchlist, addedBy from the caller's sub, addedAt
// from the server clock. The client supplies only the film snapshot and the
// fractional rank, neither of which authorizes anything.
//
// Duplicate prevention stays with WatchlistItem's composite identifier: the create
// resolver's attribute_not_exists condition fails the second concurrent write.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;

type Args = Schema['addWatchlistItem']['args'];
type Result = Schema['addWatchlistItem']['returnType'];

interface WatchlistRecord {
    ownerId: string;
    editors?: string[];
    viewers?: string[];
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
    const callerId = (event.identity as AppSyncIdentityCognito).sub;
    const { watchlistId, tmdbId, title, posterPath, releaseYear, position } = event.arguments;

    const { Item } = await docClient.send(new GetCommand({ TableName: WATCHLIST_TABLE, Key: { id: watchlistId } }));
    const watchlist = Item as WatchlistRecord | undefined;
    if (!watchlist) {
        return { success: false, error: 'NOT_FOUND' };
    }

    // The check the generated resolver structurally could not make: it only ever saw
    // the arrays the caller sent, never the parent row.
    const editors = watchlist.editors ?? [];
    if (watchlist.ownerId !== callerId && !editors.includes(callerId)) {
        return { success: false, error: 'NOT_ALLOWED' };
    }

    // ownerId is folded into `editors` rather than copied verbatim: WatchlistItem has
    // no owner field, and Watchlist.editors holds only EDITOR-role members.
    const { errors } = await client.models.WatchlistItem.create({
        watchlistId,
        tmdbId,
        title,
        posterPath: posterPath ?? null,
        releaseYear: releaseYear ?? null,
        addedBy: callerId,
        addedAt: new Date().toISOString(),
        position,
        editors: [watchlist.ownerId, ...editors],
        viewers: watchlist.viewers ?? [],
    });
    if (errors?.length) {
        if (isConditionalCheckFailure(errors)) {
            return { success: false, error: 'ALREADY_IN_LIST' };
        }
        throw new Error(
            `watchlist-item: failed to create WatchlistItem ${watchlistId}/${tmdbId}: ${JSON.stringify(errors)}`,
        );
    }

    return { success: true, error: null };
};

// The generated resolver surfaces a failed attribute_not_exists as a GraphQL error,
// not a typed result.
function isConditionalCheckFailure(errors: ReadonlyArray<{ errorType?: string; message?: string }>): boolean {
    return errors.some(
        (e) =>
            e.errorType?.includes('ConditionalCheckFailedException') ||
            e.message?.includes('ConditionalCheckFailedException'),
    );
}
