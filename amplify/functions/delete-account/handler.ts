import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { batchWriteChunked, queryAllPages } from '../shared/dynamo-batch';

// delete-account — NFR-COMP-2 ("Members shall be able to delete their account, removing
// their profile, saved films, watched records, and owned watchlists").
//
// This is deliberately the ONLY function in the app that touches seven tables. It does not
// delete the Cognito user itself — the frontend calls aws-amplify/auth's self-service
// deleteUser() (the user's own access token, no admin IAM grant needed) AFTER this mutation
// returns success, per settings-page.tsx's DeleteAccountRow. Ordering is intentional: if this
// handler throws partway through, the member is still a valid, signed-in Cognito user who can
// simply retry — every step below is naturally idempotent against a partial prior run (see
// each helper). If the Cognito deletion were to run first instead, a failure here would leave
// a member permanently logged out with orphaned data and no way to retry through the UI at all.
//
// Two design decisions this handler encodes, both made explicitly (not invented) because
// settings-page.tsx flagged them as open gaps rather than silently picking an answer:
//
// 1. A watchlist this member OWNS is cascade-deleted in full — the list, every
//    WatchlistMember row on it (every collaborator, not just this member), and every
//    WatchlistItem. Collaborators lose the list without separate warning; simpler and no
//    orphaned ownership beats the alternative (blocking account deletion on ownership
//    transfer) for a first release.
// 2. A watchlist this member does NOT own: leave it (removeSelfFromWatchlist below, the
//    same editors/viewers CAS + WatchlistMember delete membership/handler.ts's
//    leaveWatchlist performs) rather than touching WatchlistItem.addedBy at all.
//    WatchlistItem.addedBy has no way to represent "nobody" (a.string().required()) and
//    doesn't need one: watchlist-detail-page.tsx's memberLabels map is built only from the
//    CURRENT WatchlistMember list (`useWatchlistMembers`), so once this member's
//    WatchlistMember row is gone, `memberLabels.get(item.addedBy)` naturally misses and the
//    page already falls back to "A member" — exactly "films you added to shared lists stay,
//    without your name," for free, with no schema change.
//
// Known limitation, not silently worked around: WatchStatus has no reverse index from
// watchlistId to its members (its only secondary index, byUserAndList, is keyed by userId).
// When an OWNED watchlist is cascade-deleted here, OTHER collaborators' WatchStatus rows for
// items on that list are not cleaned up — they become unreachable orphans (nothing queries
// WatchStatus without a live watchlist context to scope it to, so this is inert, not a leak),
// not deleted. Closing that fully would need a new GSI on WatchStatus keyed by watchlistId —
// a schema change, not something to add silently inside this handler.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;
const WATCHLIST_ITEM_TABLE = process.env.WATCHLIST_ITEM_TABLE_NAME!;
const SAVED_MOVIE_TABLE = process.env.SAVED_MOVIE_TABLE_NAME!;
const WATCH_STATUS_TABLE = process.env.WATCH_STATUS_TABLE_NAME!;
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME!;
const USERNAME_TABLE = process.env.USERNAME_TABLE_NAME!;

const MAX_LEAVE_RETRIES = 3; // bounded retry on the editors/viewers optimistic-lock CAS below

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

async function queryAll(
    tableName: string,
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, unknown>,
    indexName?: string,
): Promise<Record<string, unknown>[]> {
    return queryAllPages(docClient, { tableName, keyConditionExpression, expressionAttributeValues, indexName });
}

// Naturally idempotent: deleting a key that's already gone is a no-op, not an error, so
// re-running this handler after a partial prior failure never fails on already-cleaned rows.
async function batchDeleteItems(tableName: string, keys: readonly Record<string, unknown>[]): Promise<void> {
    await batchWriteChunked(
        docClient,
        tableName,
        keys.map((key) => ({ DeleteRequest: { Key: key } })),
        'delete-account',
    );
}

// Decision 1 (file header): full cascade for a list this member owns. Order — items, then
// memberships, then the list itself — means a prior partial run leaves, at worst, a
// Watchlist row with no items/members left to re-query on retry (queryAll naturally returns
// empty), never the reverse (items/members outliving a deleted parent).
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

// Decision 2 (file header): membership/handler.ts's removeFromWatchlist(..., requireOwnerCaller:
// false) reimplemented here rather than called — that mutation runs under the caller's OWN
// Cognito identity (event.identity.sub), which this handler cannot forward: it runs under this
// function's own IAM identity, invoked once per membership rather than once per AppSync request.
// Same optimistic-lock shape as the original: read editors/viewers, retry the whole
// read-modify-write up to MAX_LEAVE_RETRIES times against a concurrent membership change on the
// same watchlist (rare, bounded by FR-MEM-7's 20-member cap) rather than surfacing CONFLICT to a
// caller with no per-list error channel to report it through.
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
            const memberAlreadyGone =
                err instanceof TransactionCanceledException &&
                err.CancellationReasons?.[1]?.Code === 'ConditionalCheckFailed';
            if (memberAlreadyGone) {
                return;
            }
            const lostRace =
                err instanceof TransactionCanceledException &&
                err.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed';
            if (lostRace && attempt < MAX_LEAVE_RETRIES - 1) {
                continue;
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
            await leaveWatchlist(membership.watchlistId, callerId);
        }
    }

    const watchStatuses = await queryAll(
        WATCH_STATUS_TABLE,
        'userId = :userId',
        { ':userId': callerId },
        'byUserAndList',
    );
    await batchDeleteItems(
        WATCH_STATUS_TABLE,
        watchStatuses.map((status) => ({ userId: status.userId, itemId: status.itemId })),
    );

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
