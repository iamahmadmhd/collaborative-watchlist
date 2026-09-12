import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

// Adds or removes the caller's own entry in WatchlistItem.watchedBy. See System Design
// §4.2 for why this runs in a function rather than on a generated resolver.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_ITEM_TABLE = process.env.WATCHLIST_ITEM_TABLE_NAME!;

const MAX_UNMARK_RETRIES = 3; // bounded retry on the positional-delete CAS below

type Args = Schema['toggleWatched']['args'];
type Result = Schema['toggleWatched']['returnType'];

interface WatchlistItemRecord {
    editors?: string[];
    viewers?: string[];
    watchedBy?: string[];
}

async function readItem(watchlistId: string, tmdbId: string): Promise<WatchlistItemRecord | undefined> {
    const { Item } = await docClient.send(
        new GetCommand({ TableName: WATCHLIST_ITEM_TABLE, Key: { watchlistId, tmdbId } }),
    );
    return Item as WatchlistItemRecord | undefined;
}

// Appends server-side, so there is no read-modify-write to lose: two members marking
// the same item concurrently each append their own element. The NOT contains guard
// makes a repeated call idempotent rather than duplicating the entry, and
// if_not_exists covers the first mark on an item that has no attribute yet (Amplify
// array fields have no default, so one that has never been marked carries none).
async function mark(watchlistId: string, tmdbId: string, callerId: string): Promise<void> {
    try {
        await docClient.send(
            new UpdateCommand({
                TableName: WATCHLIST_ITEM_TABLE,
                Key: { watchlistId, tmdbId },
                UpdateExpression: 'SET watchedBy = list_append(if_not_exists(watchedBy, :empty), :entry)',
                ConditionExpression:
                    'attribute_exists(watchlistId) AND (attribute_not_exists(watchedBy) OR NOT contains(watchedBy, :callerId))',
                ExpressionAttributeValues: { ':empty': [], ':entry': [callerId], ':callerId': callerId },
            }),
        );
    } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            return; // already marked, or the item went away — both are the caller's desired end state
        }
        throw err;
    }
}

// DynamoDB removes a list element by index, not by value, and an index read a moment
// ago is only valid while nobody else has shifted the list. The positional condition
// is that check: it fails rather than deleting whatever element now sits at that index,
// and the retry re-reads for the new one.
async function unmark(watchlistId: string, tmdbId: string, callerId: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_UNMARK_RETRIES; attempt++) {
        const item = await readItem(watchlistId, tmdbId);
        if (!item) {
            return true; // item gone — the mark went with it
        }
        const index = (item.watchedBy ?? []).indexOf(callerId);
        if (index === -1) {
            return true; // not marked — already the caller's desired end state
        }

        try {
            await docClient.send(
                new UpdateCommand({
                    TableName: WATCHLIST_ITEM_TABLE,
                    Key: { watchlistId, tmdbId },
                    UpdateExpression: `REMOVE watchedBy[${index}]`,
                    ConditionExpression: `watchedBy[${index}] = :callerId`,
                    ExpressionAttributeValues: { ':callerId': callerId },
                }),
            );
            return true;
        } catch (err) {
            if (err instanceof ConditionalCheckFailedException) {
                continue; // someone else's concurrent toggle moved it — re-read and retry
            }
            throw err;
        }
    }
    return false;
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
    const callerId = (event.identity as AppSyncIdentityCognito).sub;
    const { watchlistId, tmdbId, watched } = event.arguments;

    const item = await readItem(watchlistId, tmdbId);
    if (!item) {
        return { success: false, error: 'NOT_FOUND' };
    }

    // The item's own fan-out-maintained arrays, not arrays the caller sent. editors
    // already includes the Owner (permission-fanout folds ownerId in); viewers are in the
    // set too, so a Viewer passes this check.
    const members = [...(item.editors ?? []), ...(item.viewers ?? [])];
    if (!members.includes(callerId)) {
        return { success: false, error: 'NOT_ALLOWED' };
    }

    if (watched) {
        await mark(watchlistId, tmdbId, callerId);
        return { success: true, error: null };
    }

    const removed = await unmark(watchlistId, tmdbId, callerId);
    return removed ? { success: true, error: null } : { success: false, error: 'CONFLICT' };
};
