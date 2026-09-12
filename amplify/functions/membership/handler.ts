import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { conditionalCheckFailedAt } from '../shared/transact-write-errors';

// Add / remove / leave / change role. Every operation writes both a
// WatchlistMember record and the parent Watchlist's editors/viewers array, so all
// of them go through TransactWriteItems against DynamoDB directly — AppSync has no
// transactional multi-model mutation. Table names arrive via process.env from
// backend.ts.
//
// Because these writes never pass through AppSync, the schema's authorization rules
// do not apply to them: the caller checks below are the enforcement.
//
// The editors/viewers arrays are rewritten under a list-equality condition as an
// optimistic lock — DynamoDB cannot remove a single value from a list, so the whole
// array is compare-and-swapped. attribute_not_exists is OR'd in because a freshly
// created Watchlist has no array attribute at all; a lost race surfaces CONFLICT.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;
const USERNAME_TABLE = process.env.USERNAME_TABLE_NAME!;

// Including the Owner. Enforced as a pre-check rather than a DynamoDB condition:
// size() cannot safely gate on a possibly-absent array attribute.
const MAX_MEMBERS = 20;

type AddMemberArgs = Schema['addMember']['args'];
type AddMemberResult = Schema['addMember']['returnType'];
type RemoveMemberArgs = Schema['removeMember']['args'];
type LeaveWatchlistArgs = Schema['leaveWatchlist']['args'];
type MembershipResult = Schema['removeMember']['returnType'];
type ChangeRoleArgs = Schema['changeMemberRole']['args'];
type ChangeRoleResult = Schema['changeMemberRole']['returnType'];

interface WatchlistRecord {
    ownerId: string;
    editors?: string[];
    viewers?: string[];
}

async function getWatchlist(watchlistId: string): Promise<WatchlistRecord | null> {
    const { Item } = await docClient.send(new GetCommand({ TableName: WATCHLIST_TABLE, Key: { id: watchlistId } }));
    return (Item as WatchlistRecord | undefined) ?? null;
}

async function addMember(args: AddMemberArgs, callerId: string): Promise<AddMemberResult> {
    const username = args.username.trim().toLowerCase();
    const role = args.role;
    if (role !== 'EDITOR' && role !== 'VIEWER') {
        return { success: false, error: 'INVALID_ROLE' };
    }

    const { Item: usernameRecord } = await docClient.send(
        new GetCommand({ TableName: USERNAME_TABLE, Key: { username } }),
    );
    if (!usernameRecord) {
        return { success: false, error: 'USERNAME_NOT_FOUND' };
    }
    const targetUserId = usernameRecord.userId as string;

    const watchlist = await getWatchlist(args.watchlistId);
    if (!watchlist) {
        return { success: false, error: 'NOT_FOUND' };
    }
    if (watchlist.ownerId !== callerId) {
        return { success: false, error: 'NOT_OWNER' };
    }

    const editors = watchlist.editors ?? [];
    const viewers = watchlist.viewers ?? [];
    if (targetUserId === watchlist.ownerId || editors.includes(targetUserId) || viewers.includes(targetUserId)) {
        return { success: false, error: 'ALREADY_MEMBER' };
    }
    if (editors.length + viewers.length >= MAX_MEMBERS - 1) {
        return { success: false, error: 'MEMBER_CAP_REACHED' };
    }

    const newEditors = role === 'EDITOR' ? [...editors, targetUserId] : editors;
    const newViewers = role === 'VIEWER' ? [...viewers, targetUserId] : viewers;
    const now = new Date().toISOString();

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: WATCHLIST_TABLE,
                            Key: { id: args.watchlistId },
                            UpdateExpression: 'SET editors = :newEditors, viewers = :newViewers',
                            ConditionExpression:
                                'ownerId = :callerId AND (attribute_not_exists(editors) OR editors = :oldEditors) AND (attribute_not_exists(viewers) OR viewers = :oldViewers)',
                            ExpressionAttributeValues: {
                                ':newEditors': newEditors,
                                ':newViewers': newViewers,
                                ':callerId': callerId,
                                ':oldEditors': editors,
                                ':oldViewers': viewers,
                            },
                        },
                    },
                    {
                        Put: {
                            TableName: WATCHLIST_MEMBER_TABLE,
                            // Set explicitly: a raw SDK write bypasses the generated resolver
                            // that would populate them, and the generated schema marks both
                            // non-null — a missing one nulls the entire item on read.
                            Item: {
                                watchlistId: args.watchlistId,
                                userId: targetUserId,
                                role,
                                joinedAt: now,
                                createdAt: now,
                                updatedAt: now,
                            },
                            // Composite-key uniqueness: a concurrent duplicate add fails here
                            // rather than in a check-then-write race.
                            ConditionExpression: 'attribute_not_exists(watchlistId)',
                        },
                    },
                ],
            }),
        );
    } catch (err) {
        if (conditionalCheckFailedAt(err, 1)) {
            return { success: false, error: 'ALREADY_MEMBER' };
        }
        if (conditionalCheckFailedAt(err, 0)) {
            return { success: false, error: 'CONFLICT' };
        }
        throw err;
    }

    return { success: true, error: null };
}

async function removeFromWatchlist(
    watchlistId: string,
    targetUserId: string,
    callerId: string,
    requireOwnerCaller: boolean,
): Promise<MembershipResult> {
    const watchlist = await getWatchlist(watchlistId);
    if (!watchlist) {
        return { success: false, error: 'NOT_FOUND' };
    }
    if (requireOwnerCaller && watchlist.ownerId !== callerId) {
        return { success: false, error: 'NOT_OWNER' };
    }
    // The Owner can neither leave nor be removed from their own watchlist.
    if (targetUserId === watchlist.ownerId) {
        return { success: false, error: 'CANNOT_REMOVE_OWNER' };
    }

    const editors = watchlist.editors ?? [];
    const viewers = watchlist.viewers ?? [];
    if (!editors.includes(targetUserId) && !viewers.includes(targetUserId)) {
        return { success: false, error: 'NOT_A_MEMBER' };
    }
    const newEditors = editors.filter((id) => id !== targetUserId);
    const newViewers = viewers.filter((id) => id !== targetUserId);

    // Re-asserted here, not just in the pre-check above, so the owner gate is atomic
    // with the write rather than TOCTOU-able.
    const ownerConditionExpression = requireOwnerCaller ? 'ownerId = :callerId AND ' : '';

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: WATCHLIST_TABLE,
                            Key: { id: watchlistId },
                            UpdateExpression: 'SET editors = :newEditors, viewers = :newViewers',
                            ConditionExpression: `${ownerConditionExpression}ownerId <> :targetUserId AND (attribute_not_exists(editors) OR editors = :oldEditors) AND (attribute_not_exists(viewers) OR viewers = :oldViewers)`,
                            ExpressionAttributeValues: {
                                ':newEditors': newEditors,
                                ':newViewers': newViewers,
                                ':targetUserId': targetUserId,
                                ':oldEditors': editors,
                                ':oldViewers': viewers,
                                ...(requireOwnerCaller ? { ':callerId': callerId } : {}),
                            },
                        },
                    },
                    {
                        Delete: {
                            TableName: WATCHLIST_MEMBER_TABLE,
                            Key: { watchlistId, userId: targetUserId },
                            ConditionExpression: 'attribute_exists(watchlistId)',
                        },
                    },
                ],
            }),
        );
    } catch (err) {
        if (conditionalCheckFailedAt(err, 1)) {
            return { success: false, error: 'NOT_A_MEMBER' };
        }
        if (conditionalCheckFailedAt(err, 0)) {
            return { success: false, error: 'CONFLICT' };
        }
        throw err;
    }

    return { success: true, error: null };
}

// Moves the target between the editors/viewers arrays and updates
// WatchlistMember.role in one transaction, so the record and the arrays never
// observably disagree.
async function changeMemberRole(args: ChangeRoleArgs, callerId: string): Promise<ChangeRoleResult> {
    const role = args.role;
    if (role !== 'EDITOR' && role !== 'VIEWER') {
        return { success: false, error: 'INVALID_ROLE' };
    }

    const watchlist = await getWatchlist(args.watchlistId);
    if (!watchlist) {
        return { success: false, error: 'NOT_FOUND' };
    }
    if (watchlist.ownerId !== callerId) {
        return { success: false, error: 'NOT_OWNER' };
    }
    // The Owner's own role is fixed — there is nothing to reassign it to.
    if (args.userId === watchlist.ownerId) {
        return { success: false, error: 'CANNOT_CHANGE_OWNER' };
    }

    const editors = watchlist.editors ?? [];
    const viewers = watchlist.viewers ?? [];
    if (!editors.includes(args.userId) && !viewers.includes(args.userId)) {
        return { success: false, error: 'NOT_A_MEMBER' };
    }

    const withoutTarget = {
        editors: editors.filter((id) => id !== args.userId),
        viewers: viewers.filter((id) => id !== args.userId),
    };
    const newEditors = role === 'EDITOR' ? [...withoutTarget.editors, args.userId] : withoutTarget.editors;
    const newViewers = role === 'VIEWER' ? [...withoutTarget.viewers, args.userId] : withoutTarget.viewers;
    const now = new Date().toISOString();

    try {
        await docClient.send(
            new TransactWriteCommand({
                TransactItems: [
                    {
                        Update: {
                            TableName: WATCHLIST_TABLE,
                            Key: { id: args.watchlistId },
                            UpdateExpression: 'SET editors = :newEditors, viewers = :newViewers',
                            ConditionExpression:
                                'ownerId = :callerId AND (attribute_not_exists(editors) OR editors = :oldEditors) AND (attribute_not_exists(viewers) OR viewers = :oldViewers)',
                            ExpressionAttributeValues: {
                                ':newEditors': newEditors,
                                ':newViewers': newViewers,
                                ':callerId': callerId,
                                ':oldEditors': editors,
                                ':oldViewers': viewers,
                            },
                        },
                    },
                    {
                        Update: {
                            TableName: WATCHLIST_MEMBER_TABLE,
                            Key: { watchlistId: args.watchlistId, userId: args.userId },
                            UpdateExpression: 'SET #role = :role, updatedAt = :updatedAt',
                            ConditionExpression: 'attribute_exists(watchlistId)',
                            ExpressionAttributeNames: { '#role': 'role' },
                            ExpressionAttributeValues: { ':role': role, ':updatedAt': now },
                        },
                    },
                ],
            }),
        );
    } catch (err) {
        if (conditionalCheckFailedAt(err, 1)) {
            return { success: false, error: 'NOT_A_MEMBER' };
        }
        if (conditionalCheckFailedAt(err, 0)) {
            return { success: false, error: 'CONFLICT' };
        }
        throw err;
    }

    return { success: true, error: null };
}

// Dispatch is by argument shape, not event.info.fieldName: event.info arrives
// undefined for Lambda-backed custom operations in this deployment, while
// event.identity and event.arguments are present. The four argument sets are
// mutually distinguishable — only addMember carries `username`, only removeMember
// and changeMemberRole carry `userId`, only the latter also carries `role`, and
// leaveWatchlist carries neither.
export const handler: AppSyncResolverHandler<Record<string, unknown>, unknown> = async (event) => {
    const callerId = (event.identity as AppSyncIdentityCognito).sub;
    const args = event.arguments as Record<string, unknown>;

    if (typeof args.username === 'string') {
        return addMember(args as AddMemberArgs, callerId);
    }

    if (typeof args.userId === 'string') {
        if ('role' in args) {
            return changeMemberRole(args as ChangeRoleArgs, callerId);
        }
        // Only the Owner may remove another member.
        return removeFromWatchlist((args as RemoveMemberArgs).watchlistId, args.userId, callerId, true);
    }

    // Any collaborator may remove themselves — no Owner-caller check.
    return removeFromWatchlist((args as LeaveWatchlistArgs).watchlistId, callerId, callerId, false);
};
