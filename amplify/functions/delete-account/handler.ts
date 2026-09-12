import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { batchWriteChunked, queryAllPages } from '../shared/dynamo-batch';
import { conditionalCheckFailedAt } from '../shared/transact-write-errors';

// Deletes the caller's data across six tables. It does not delete the Cognito user
// itself — the frontend calls deleteUser() after this mutation returns. That order
// matters: a failure here leaves a still-signed-in member who can retry, and every
// step below is idempotent against a partial prior run. The reverse order would strand
// a logged-out member with orphaned data and no way to retry.
//
// Owned watchlists are cascade-deleted in full; watchlists owned by someone else are
// merely left. See System Design §4.2 for both decisions and their consequences.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;
const WATCHLIST_ITEM_TABLE = process.env.WATCHLIST_ITEM_TABLE_NAME!;
const SAVED_MOVIE_TABLE = process.env.SAVED_MOVIE_TABLE_NAME!;
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME!;
const USERNAME_TABLE = process.env.USERNAME_TABLE_NAME!;

const MAX_LEAVE_RETRIES = 3; // bounded retry on the editors/viewers optimistic-lock CAS below
const MAX_UNMARK_RETRIES = 3; // bounded retry on the watchedBy positional-delete CAS below

type DeleteAccountResult = Schema['deleteAccount']['returnType'];

interface WatchlistMemberRecord {
    watchlistId: string;
    userId: string;
    role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

interface WatchlistRecord {
    editors?: string[];
    viewers?: string[];
}

interface WatchlistItemKey {
    watchlistId: string;
    tmdbId: string;
    watchedBy?: string[];
}

async function queryAll(
    tableName: string,
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, unknown>,
    indexName?: string,
): Promise<Record<string, unknown>[]> {
    return queryAllPages(docClient, { tableName, keyConditionExpression, expressionAttributeValues, indexName });
}

// Idempotent: deleting an already-absent key is a no-op, so a re-run after a partial
// failure never trips on already-cleaned rows.
async function batchDeleteItems(tableName: string, keys: readonly Record<string, unknown>[]): Promise<void> {
    await batchWriteChunked(
        docClient,
        tableName,
        keys.map((key) => ({ DeleteRequest: { Key: key } })),
        'delete-account',
    );
}

// Items, then memberships, then the list itself: a partial run leaves at worst an empty
// Watchlist row to re-query, never items outliving a deleted parent.
async function cascadeDeleteOwnedWatchlist(watchlistId: string): Promise<void> {
    const items = await queryAll(WATCHLIST_ITEM_TABLE, 'watchlistId = :watchlistId', {
        ':watchlistId': watchlistId,
    });
    await batchDeleteItems(
        WATCHLIST_ITEM_TABLE,
        items.map((item) => ({ watchlistId: item.watchlistId, tmdbId: item.tmdbId })),
    );

    const members = await queryAll(WATCHLIST_MEMBER_TABLE, 'watchlistId = :watchlistId', {
        ':watchlistId': watchlistId,
    });
    await batchDeleteItems(
        WATCHLIST_MEMBER_TABLE,
        members.map((member) => ({ watchlistId: member.watchlistId, userId: member.userId })),
    );

    await docClient.send(new DeleteCommand({ TableName: WATCHLIST_TABLE, Key: { id: watchlistId } }));
}

// Strips the caller from watchedBy on every item of a list they only collaborate on. A
// list they own needs none of this: its items are deleted outright. See System Design
// §4.2 for how this differs from a member merely leaving a list.
//
// An element is removed by index under a positional condition rather than by rewriting
// the array, so a concurrent mark by another member cannot be clobbered; see
// toggle-watched's handler for the same mechanism and why the index needs re-reading.
async function stripWatchedMarks(watchlistId: string, callerId: string): Promise<void> {
    const items = (await queryAll(WATCHLIST_ITEM_TABLE, 'watchlistId = :watchlistId', {
        ':watchlistId': watchlistId,
    })) as unknown as WatchlistItemKey[];

    for (const item of items) {
        for (let attempt = 0; attempt < MAX_UNMARK_RETRIES; attempt++) {
            const watchedBy =
                attempt === 0 ? (item.watchedBy ?? []) : ((await readWatchedBy(item.watchlistId, item.tmdbId)) ?? []);
            const index = watchedBy.indexOf(callerId);
            if (index === -1) {
                break; // never marked, already stripped, or the item is gone
            }

            try {
                await docClient.send(
                    new UpdateCommand({
                        TableName: WATCHLIST_ITEM_TABLE,
                        Key: { watchlistId: item.watchlistId, tmdbId: item.tmdbId },
                        UpdateExpression: `REMOVE watchedBy[${index}]`,
                        ConditionExpression: `watchedBy[${index}] = :callerId`,
                        ExpressionAttributeValues: { ':callerId': callerId },
                    }),
                );
                break;
            } catch (err) {
                if (err instanceof ConditionalCheckFailedException) {
                    continue; // the list shifted under us — re-read and retry
                }
                throw err;
            }
        }
    }
}

async function readWatchedBy(watchlistId: string, tmdbId: string): Promise<string[] | undefined> {
    const { Item } = await docClient.send(
        new GetCommand({ TableName: WATCHLIST_ITEM_TABLE, Key: { watchlistId, tmdbId } }),
    );
    return (Item as WatchlistItemKey | undefined)?.watchedBy;
}

// membership's leaveWatchlist reimplemented rather than called: that mutation runs under
// the caller's own Cognito identity, which this handler — running under its own IAM
// identity, once per membership — cannot forward. Same optimistic lock, but it retries
// the read-modify-write instead of surfacing CONFLICT to a caller with nowhere to show it.
async function leaveWatchlist(watchlistId: string, callerId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_LEAVE_RETRIES; attempt++) {
        const { Item } = await docClient.send(new GetCommand({ TableName: WATCHLIST_TABLE, Key: { id: watchlistId } }));
        const watchlist = Item as WatchlistRecord | undefined;
        if (!watchlist) {
            return; // already cascade-deleted (e.g. by a concurrent owner deletion) — nothing to leave
        }

        const editors = watchlist.editors ?? [];
        const viewers = watchlist.viewers ?? [];
        if (!editors.includes(callerId) && !viewers.includes(callerId)) {
            return; // already removed — redelivered/retried call
        }
        const newEditors = editors.filter((id) => id !== callerId);
        const newViewers = viewers.filter((id) => id !== callerId);

        try {
            await docClient.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: WATCHLIST_TABLE,
                                Key: { id: watchlistId },
                                UpdateExpression: 'SET editors = :newEditors, viewers = :newViewers',
                                ConditionExpression:
                                    '(attribute_not_exists(editors) OR editors = :oldEditors) AND (attribute_not_exists(viewers) OR viewers = :oldViewers)',
                                ExpressionAttributeValues: {
                                    ':newEditors': newEditors,
                                    ':newViewers': newViewers,
                                    ':oldEditors': editors,
                                    ':oldViewers': viewers,
                                },
                            },
                        },
                        {
                            Delete: {
                                TableName: WATCHLIST_MEMBER_TABLE,
                                Key: { watchlistId, userId: callerId },
                                ConditionExpression: 'attribute_exists(watchlistId)',
                            },
                        },
                    ],
                }),
            );
            return;
        } catch (err) {
            if (conditionalCheckFailedAt(err, 1)) {
                return; // member already gone
            }
            if (conditionalCheckFailedAt(err, 0) && attempt < MAX_LEAVE_RETRIES - 1) {
                continue; // lost the optimistic-lock race — retry
            }
            throw err;
        }
    }
}

export const handler: AppSyncResolverHandler<Record<string, unknown>, DeleteAccountResult> = async (event) => {
    const callerId = (event.identity as AppSyncIdentityCognito).sub;

    const memberships = (await queryAll(
        WATCHLIST_MEMBER_TABLE,
        'userId = :userId',
        { ':userId': callerId },
        'byUser',
    )) as unknown as WatchlistMemberRecord[];

    for (const membership of memberships) {
        if (membership.role === 'OWNER') {
            await cascadeDeleteOwnedWatchlist(membership.watchlistId);
        } else {
            await stripWatchedMarks(membership.watchlistId, callerId);
            await leaveWatchlist(membership.watchlistId, callerId);
        }
    }

    const savedMovies = await queryAll(SAVED_MOVIE_TABLE, 'userId = :userId', { ':userId': callerId }, 'byUserAndDate');
    await batchDeleteItems(
        SAVED_MOVIE_TABLE,
        savedMovies.map((movie) => ({ userId: movie.userId, tmdbId: movie.tmdbId })),
    );

    const { Item: profile } = await docClient.send(
        new GetCommand({ TableName: USER_PROFILE_TABLE, Key: { id: callerId } }),
    );
    if (profile?.username) {
        await docClient.send(new DeleteCommand({ TableName: USERNAME_TABLE, Key: { username: profile.username } }));
    }
    await docClient.send(new DeleteCommand({ TableName: USER_PROFILE_TABLE, Key: { id: callerId } }));

    return { success: true };
};
