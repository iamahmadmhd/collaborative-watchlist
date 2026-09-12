import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { batchWriteChunked, queryAllPages } from '../shared/dynamo-batch';

// One function consuming two DynamoDB Streams, Watchlist and WatchlistItem (both
// wired in backend.ts), with three jobs — see System Design §4.5 for why they share
// a function:
//
// 1. Propagating a Watchlist's editors/viewers down to every WatchlistItem under it.
// 2. Maintaining Watchlist.itemCount from the WatchlistItem stream.
// 3. Writing the WatchlistMember(OWNER) row for a newly created watchlist.
//
// Records are routed by the eventSourceARN that produced them. The handler returns
// batchItemFailures so a retry re-runs only the records that failed.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_ITEM_TABLE = process.env.WATCHLIST_ITEM_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;

function isImageOf(record: DynamoDBRecord, tableName: string): boolean {
    return record.eventSourceARN?.includes(`table/${tableName}/`) ?? false;
}

function toRecord(image: Record<string, AttributeValue> | undefined): Record<string, unknown> | undefined {
    return image ? unmarshall(image) : undefined;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((value, i) => value === sortedB[i]);
}

async function queryAllItems(watchlistId: string): Promise<Record<string, unknown>[]> {
    return queryAllPages(docClient, {
        tableName: WATCHLIST_ITEM_TABLE,
        keyConditionExpression: 'watchlistId = :watchlistId',
        expressionAttributeValues: { ':watchlistId': watchlistId },
    });
}

async function batchPutItems(items: readonly Record<string, unknown>[]): Promise<void> {
    await batchWriteChunked(
        docClient,
        WATCHLIST_ITEM_TABLE,
        items.map((item) => ({ PutRequest: { Item: item } })),
        'permission-fanout',
    );
}

// Idempotent by construction: each item's arrays are unconditionally overwritten
// rather than patched, so a replay converges instead of drifting. Amplify Data array
// fields have no default, so a newly created Watchlist has no attribute at all.
async function handleWatchlistRecord(record: DynamoDBRecord): Promise<void> {
    if (record.eventName === 'INSERT') {
        await createOwnerMembership(record);
        return;
    }
    if (record.eventName !== 'MODIFY') {
        return; // Cascading item deletion is delete-account's job, not this stream's.
    }
    const oldImage = toRecord(record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined);
    const newImage = toRecord(record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined);
    if (!oldImage || !newImage) {
        return;
    }

    const oldEditors = (oldImage.editors as string[] | undefined) ?? [];
    const oldViewers = (oldImage.viewers as string[] | undefined) ?? [];
    const newEditors = (newImage.editors as string[] | undefined) ?? [];
    const newViewers = (newImage.viewers as string[] | undefined) ?? [];

    if (sameMembers(oldEditors, newEditors) && sameMembers(oldViewers, newViewers)) {
        return; // e.g. a name/description edit — not a permission-relevant change
    }

    const watchlistId = newImage.id as string;
    const ownerId = newImage.ownerId as string;
    const items = await queryAllItems(watchlistId);
    if (items.length === 0) {
        return;
    }

    // WatchlistItem has no owner field, so the Owner's access to an item depends
    // entirely on appearing in this array — while Watchlist.editors itself holds
    // only EDITOR-role members. ownerId must therefore be injected on every
    // propagation, or the Owner loses access the moment membership first changes.
    const itemEditors = [ownerId, ...newEditors];
    await batchPutItems(items.map((item) => ({ ...item, editors: itemEditors, viewers: newViewers })));
}

// One Put, not a transaction: the Watchlist row is already durable by the time the
// stream delivers it, so a failure only needs retrying. attribute_not_exists makes a
// redelivered INSERT a no-op rather than clobbering joinedAt.
//
// createdAt/updatedAt are set explicitly: a raw Put bypasses the generated resolver
// that would populate them, and the generated schema marks both non-null — a missing
// one nulls the whole item on read.
async function createOwnerMembership(record: DynamoDBRecord): Promise<void> {
    const newImage = toRecord(record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined);
    const watchlistId = newImage?.id as string | undefined;
    const ownerId = newImage?.ownerId as string | undefined;
    if (!watchlistId || !ownerId) {
        return;
    }

    try {
        const now = new Date().toISOString();
        await docClient.send(
            new PutCommand({
                TableName: WATCHLIST_MEMBER_TABLE,
                Item: {
                    watchlistId,
                    userId: ownerId,
                    role: 'OWNER',
                    joinedAt: now,
                    createdAt: now,
                    updatedAt: now,
                },
                ConditionExpression: 'attribute_not_exists(watchlistId)',
            }),
        );
    } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            return; // already created — a redelivered INSERT record
        }
        throw err;
    }
}

// INSERT -> +1, REMOVE -> -1, MODIFY -> no-op. attribute_exists(id) stops UpdateItem
// upserting a deleted Watchlist back as a phantom {id, itemCount} row, since a REMOVE
// event can arrive after a cascading list deletion; a condition failure there means
// "nothing to update", not an error.
async function handleWatchlistItemRecord(record: DynamoDBRecord): Promise<void> {
    let watchlistId: string | undefined;
    let delta: number;

    if (record.eventName === 'INSERT') {
        const newImage = toRecord(record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined);
        watchlistId = newImage?.watchlistId as string | undefined;
        delta = 1;
    } else if (record.eventName === 'REMOVE') {
        const oldImage = toRecord(record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined);
        watchlistId = oldImage?.watchlistId as string | undefined;
        delta = -1;
    } else {
        return;
    }
    if (!watchlistId) {
        return;
    }

    try {
        await docClient.send(
            new UpdateCommand({
                TableName: WATCHLIST_TABLE,
                Key: { id: watchlistId },
                UpdateExpression: 'ADD itemCount :delta',
                ConditionExpression: 'attribute_exists(id)',
                ExpressionAttributeValues: { ':delta': delta },
            }),
        );
    } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            return;
        }
        throw err;
    }
}

export const handler: DynamoDBStreamHandler = async (event): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: DynamoDBBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
        try {
            if (isImageOf(record, WATCHLIST_TABLE)) {
                await handleWatchlistRecord(record);
            } else if (isImageOf(record, WATCHLIST_ITEM_TABLE)) {
                await handleWatchlistItemRecord(record);
            }
        } catch (err) {
            console.error('permission-fanout: failed to process record', record.eventID, err);
            if (record.dynamodb?.SequenceNumber) {
                batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
            }
        }
    }

    return { batchItemFailures };
};
