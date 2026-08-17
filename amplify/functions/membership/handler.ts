import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

// membership — System Design §4.2, §4.4, §4.5
//
// The transactional function: add / remove / leave a collaborator. Adding a
// collaborator writes a WatchlistMember record AND pushes the user into the
// parent Watchlist's editors/viewers array — two tables, and FR-MEM-8 forbids
// an observable partial result (one table updated, the other not).
//
// This talks to DynamoDB directly via TransactWriteItems, bypassing AppSync
// entirely for its writes — there is no generated-resolver or GraphQL
// equivalent for an atomic write across two models. Table names arrive via
// process.env, injected post-hoc in backend.ts once backend.data's tables
// exist (see resource.ts). Because these writes never go through AppSync,
// Amplify's allow.owner()/ownersDefinedIn() rules on Watchlist have no bearing
// on this function at all — those rules only govern GraphQL-originating
// requests. The authorization checks below (ownerId comparison, self-only
// leave) ARE the enforcement mechanism for FR-MEM-9 on this path; the
// data/resource.ts field-level rules close the *separate* GraphQL-facing hole
// (an Editor calling the generic update mutation directly).
//
// Remove and leave are the same transaction inverted: both delete a
// WatchlistMember row and drop the user from whichever of editors/viewers
// they were in. They differ only in who may call them (Owner-only for
// removeMember; any collaborator acting on themselves for leaveWatchlist) and
// in the FR-MEM-6 guard (the Owner can never be the target of either).
//
// Concurrency: editors/viewers arrays are read, then rewritten via a
// list-equality condition (`editors = :oldEditors`) as an optimistic lock —
// DynamoDB has no "remove one value from a list" primitive, so a full-array
// compare-and-swap is the mechanism. attribute_not_exists(editors) is OR'd in
// because a freshly created Watchlist may not have the attribute set at all
// (no array-type default exists in the Amplify Data schema builder); treating
// "absent" as "empty" avoids a false CONFLICT on a brand-new list. A
// concurrent membership change on the same watchlist loses this race and
// surfaces CONFLICT — rare (bounded by FR-MEM-7's 20-member cap), and the
// caller can retry.
//
// This function is also the mechanism by which FR-MEM-9 / NFR-SEC-2 hold on
// the GraphQL surface: since ownerId/editors/viewers have no update grant to
// anyone via AppSync (data/resource.ts field-level auth), this Lambda's direct
// IAM-granted table access is the ONLY way those fields ever change.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;
const HANDLE_TABLE = process.env.HANDLE_TABLE_NAME!;

// FR-MEM-7: 20 members per watchlist, including the Owner. Enforced as a
// pre-check (below) rather than a DynamoDB-side condition — see the file
// header on why size() can't safely gate on a possibly-absent array attribute.
const MAX_MEMBERS = 20;

type AddMemberArgs = Schema['addMember']['args'];
type AddMemberResult = Schema['addMember']['returnType'];
type RemoveMemberArgs = Schema['removeMember']['args'];
type LeaveWatchlistArgs = Schema['leaveWatchlist']['args'];
type MembershipResult = Schema['removeMember']['returnType'];

interface WatchlistRecord {
    ownerId: string;
    editors?: string[];
    viewers?: string[];
}

async function getWatchlist(watchlistId: string): Promise<WatchlistRecord | null> {
    const { Item } = await docClient.send(new GetCommand({ TableName: WATCHLIST_TABLE, Key: { id: watchlistId } }));
    return (Item as WatchlistRecord | undefined) ?? null;
}

function conditionalCheckFailedAt(err: unknown, index: number): boolean {
    return (
        err instanceof TransactionCanceledException &&
        err.CancellationReasons?.[index]?.Code === 'ConditionalCheckFailed'
    );
}

async function addMember(args: AddMemberArgs, callerId: string): Promise<AddMemberResult> {
    const handle = args.handle.trim().toLowerCase();
    const role = args.role;
    if (role !== 'EDITOR' && role !== 'VIEWER') {
        return { success: false, error: 'INVALID_ROLE' };
    }

    const { Item: handleRecord } = await docClient.send(new GetCommand({ TableName: HANDLE_TABLE, Key: { handle } }));
    if (!handleRecord) {
        return { success: false, error: 'HANDLE_NOT_FOUND' };
    }
    const targetUserId = handleRecord.userId as string;

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
                            Item: {
                                watchlistId: args.watchlistId,
                                userId: targetUserId,
                                role,
                                joinedAt: new Date().toISOString(),
                            },
                            // Composite-key uniqueness, same idiom as Handle.create() (ADR-008):
                            // a concurrent duplicate add fails here, not with a check-then-write race.
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
    // FR-MEM-6: the Owner can neither leave nor be removed from their own watchlist.
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

    // requireOwnerCaller is re-asserted here, not just in the JS pre-check above, so the
    // owner gate is atomic with the write rather than TOCTOU-able — same reasoning as
    // addMember's `ownerId = :callerId` condition, kept consistent across both paths even
    // though ownerId happens to be write-once today (see file header).
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

export const handler: AppSyncResolverHandler<Record<string, unknown>, unknown> = async (event) => {
    const callerId = (event.identity as AppSyncIdentityCognito).sub;

    switch (event.info.fieldName) {
        case 'addMember':
            return addMember(event.arguments as AddMemberArgs, callerId);

        case 'removeMember': {
            const args = event.arguments as RemoveMemberArgs;
            // FR-MEM-4: only the Owner may remove another member.
            return removeFromWatchlist(args.watchlistId, args.userId, callerId, true);
        }

        case 'leaveWatchlist': {
            const args = event.arguments as LeaveWatchlistArgs;
            // FR-MEM-5: any collaborator may remove themselves — no Owner-caller check.
            return removeFromWatchlist(args.watchlistId, callerId, callerId, false);
        }

        default:
            throw new Error(`membership: unhandled field "${event.info.fieldName}"`);
    }
};
