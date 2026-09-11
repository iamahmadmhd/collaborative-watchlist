import type { AppSyncIdentityCognito, AppSyncResolverHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { conditionalCheckFailedAt } from '../shared/transact-write-errors';

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
const USERNAME_TABLE = process.env.USERNAME_TABLE_NAME!;

// FR-MEM-7: 20 members per watchlist, including the Owner. Enforced as a
// pre-check (below) rather than a DynamoDB-side condition — see the file
// header on why size() can't safely gate on a possibly-absent array attribute.
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
                            // createdAt/updatedAt set explicitly — this TransactWriteItems call
                            // bypasses the generated resolver that would normally populate them,
                            // and Amplify's generated schema marks both non-null. Leaving them
                            // absent doesn't just omit a nicety: AppSync nulls the whole item on
                            // read (GraphQL null-propagation from a missing non-null field), which
                            // is exactly what broke useWatchlists() the first time a raw-SDK
                            // WatchlistMember write (permission-fanout's own, same fix) was read
                            // back through the generated client — see that function's handler.ts.
                            Item: {
                                watchlistId: args.watchlistId,
                                userId: targetUserId,
                                role,
                                joinedAt: now,
                                createdAt: now,
                                updatedAt: now,
                            },
                            // Composite-key uniqueness, same idiom as Username.create() (ADR-008):
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

// FR-MEM-3's "change it afterwards" clause. Mirrors addMember/removeFromWatchlist's
// shape exactly: read the Watchlist, assert caller===ownerId, move the target between
// the editors/viewers arrays under the same list-equality optimistic lock, and update
// WatchlistMember.role in the same transaction so the membership record and the
// permission arrays never observably disagree (FR-MEM-8). permission-fanout's own
// Watchlist-stream handler already diffs old/new editors/viewers unconditionally
// (handler.ts there), so a role swap fans out to WatchlistItem exactly like an
// add/remove would — nothing about that consumer needed to change.
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
    // FR-MEM-6: the Owner's own role is fixed — nothing to reassign it to.
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

// Dispatch is by argument shape, not event.info.fieldName: in a real
// deployment, event.info comes back undefined while event.identity/
// event.arguments are present (confirmed via CloudWatch: "Cannot read
// properties of undefined (reading 'fieldName')" at that switch, with the
// crash happening after event.identity was already read successfully on the
// line above it). A previous revision of this comment guessed the cause was
// this function's `resourceGroupName: 'data'` override (resource.ts, needed
// to avoid a CloudFormation circular dependency between the data stack and
// this function's stack) supposedly changing how AppSync's generated
// resolver invokes it — and that tmdb-proxy/handler.ts's identical
// switch-on-event.info.fieldName pattern was fine without that override.
// That guess is disproven: tmdb-proxy hits the identical crash despite
// having no such override (see its own handler.ts), so event.info is
// unreliable for Lambda-backed multi-operation custom queries/mutations in
// this deployment generally, not something tied to one function's resource
// grouping. Whatever the real cause is, it isn't fixable from here, so both
// functions dispatch on the arguments' own shape instead: this function's
// four operations' argument sets are mutually distinguishable by
// construction (only addMember carries `username`; only removeMember/
// changeMemberRole carry `userId`, and only the latter also carries `role`;
// leaveWatchlist carries neither).
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
        // FR-MEM-4: only the Owner may remove another member.
        return removeFromWatchlist((args as RemoveMemberArgs).watchlistId, args.userId, callerId, true);
    }

    // FR-MEM-5: any collaborator may remove themselves — no Owner-caller check.
    return removeFromWatchlist((args as LeaveWatchlistArgs).watchlistId, callerId, callerId, false);
};
