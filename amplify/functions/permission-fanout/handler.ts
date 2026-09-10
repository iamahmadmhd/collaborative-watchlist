import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import { ConditionalCheckFailedException, DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import {
    BatchWriteCommand,
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// permission-fanout — System Design §4.5, §5.4, ADR-001
//
// One function, two DynamoDB Streams (both wired in backend.ts): Watchlist and
// WatchlistItem. It owns two responsibilities that both boil down to "keep
// WatchlistItem/Watchlist consistent after a write the generated resolvers
// couldn't make atomic or couldn't see":
//
// 1. Permission fan-out (§4.5, ADR-001). WatchlistItem carries its own
//    editors/viewers copy so AppSync can authorize per-item reads/subscriptions
//    without a parent lookup. When a Watchlist's editors/viewers change (via
//    membership/handler.ts — the only writer), every item under that watchlist
//    needs the same new arrays. Membership changes are rare and bounded (FR-MEM-7:
//    max 20 members), so re-querying and rewriting every item on each change is
//    cheap relative to the read-hot path it protects.
//
// 2. itemCount maintenance (§5.4, FR-LIST-6). Items are created/deleted through
//    the generated resolver, which has no hook to touch the parent Watchlist —
//    this stream is that hook. An atomic ADD keeps it accurate without a
//    read-modify-write race; MODIFY events (reorder, watched-toggle) don't touch
//    count and are ignored.
//
// 3. Owner membership creation (§5.1, FR-LIST-1/5). WatchlistItem CRUD aside,
//    §4.1 states list CRUD runs on Amplify's generated resolver — so a plain
//    Watchlist.create() is the entire creation path — but WatchlistMember has
//    no user-facing write grant at all (data/resource.ts): only membership/
//    handler.ts can write it, and that function only ever handles add/remove/
//    leave, never initial creation. Without a WatchlistMember(OWNER) row,
//    access pattern #3 (§5.2, the byUser index this project's /lists screen
//    reads) would never surface a member's own brand-new list back to them.
//    This stream's INSERT handler is that missing write. A dedicated
//    createWatchlist Lambda mirroring membership's TransactWriteItems would
//    remove the eventual-consistency window this introduces, but at the cost
//    of a sixth function contradicting §4.1's stated restraint — this stream
//    is already paying for itself on every Watchlist write, so one more Put
//    here is the smaller addition, consistent with the eventually-consistent
//    posture NFR-SEC-4 and itemCount already accept elsewhere in this file.
//
// All three are driven by the same event.Records loop below, routed by which table's
// stream produced each record (via eventSourceARN). Sharing one function is
// deliberate (§4.5) — one DLQ, one consistency story, not two.
//
// Batch handling: returns `batchItemFailures` (reportBatchItemFailures is enabled
// on both event source mappings in backend.ts) so a failure in one record doesn't
// force Lambda to retry records in the same batch that already succeeded — that
// matters most for fan-out's BatchWriteItem calls, which are NOT individually
// idempotency-guarded beyond "overwrite, not delta" (§4.5's own stated property).
// Records that exhaust retries land in the DLQ per that same requirement — a
// silent failure here means stale permissions with nothing surfacing.

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const WATCHLIST_TABLE = process.env.WATCHLIST_TABLE_NAME!;
const WATCHLIST_ITEM_TABLE = process.env.WATCHLIST_ITEM_TABLE_NAME!;
const WATCHLIST_MEMBER_TABLE = process.env.WATCHLIST_MEMBER_TABLE_NAME!;

const BATCH_WRITE_CHUNK_SIZE = 25; // DynamoDB's hard per-call limit (§4.5)
const MAX_BATCH_WRITE_RETRIES = 5;

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

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryAllItems(watchlistId: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
        const result = await docClient.send(
            new QueryCommand({
                TableName: WATCHLIST_ITEM_TABLE,
                KeyConditionExpression: 'watchlistId = :watchlistId',
                ExpressionAttributeValues: { ':watchlistId': watchlistId },
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );
        items.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
}

async function batchPutItems(items: readonly Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < items.length; i += BATCH_WRITE_CHUNK_SIZE) {
        let pending = items.slice(i, i + BATCH_WRITE_CHUNK_SIZE);
        let attempt = 0;

        while (pending.length > 0) {
            const result = await docClient.send(
                new BatchWriteCommand({
                    RequestItems: {
                        [WATCHLIST_ITEM_TABLE]: pending.map((item) => ({ PutRequest: { Item: item } })),
                    },
                }),
            );
            const unprocessed = result.UnprocessedItems?.[WATCHLIST_ITEM_TABLE];
            if (!unprocessed || unprocessed.length === 0) {
                break;
            }
            attempt += 1;
            if (attempt > MAX_BATCH_WRITE_RETRIES) {
                throw new Error(
                    `permission-fanout: BatchWriteItem still had ${unprocessed.length} unprocessed item(s) after ${MAX_BATCH_WRITE_RETRIES} retries`,
                );
            }
            pending = unprocessed
                .map((request) => request.PutRequest?.Item as Record<string, unknown> | undefined)
                .filter((item): item is Record<string, unknown> => item != null);
            await sleep(2 ** attempt * 50); // basic exponential backoff — throughput contention only, not correctness
        }
    }
}

// §4.5: compares old/new Watchlist images; if editors or viewers changed, rewrites
// every item under that watchlist. Idempotent by construction — each item's
// editors/viewers are unconditionally overwritten to the NEW arrays, so replaying
// this on retry (or out of order relative to a later change, since it always
// writes the value that was current as of THIS record) converges rather than
// drifts. Amplify Data's array fields have no default, so a Watchlist immediately
// after creation (before any membership change) legitimately has no editors/
// viewers attribute at all — `?? []` treats that as empty rather than throwing.
async function handleWatchlistRecord(record: DynamoDBRecord): Promise<void> {
    if (record.eventName === 'INSERT') {
        await createOwnerMembership(record);
        return;
    }
    if (record.eventName !== 'MODIFY') {
        return; // REMOVE: cascading item deletion is a separate concern (FR-LIST-4), not this stream's job.
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

    // WatchlistItem's own authorization (data/resource.ts) is
    // allow.ownersDefinedIn('editors') for full CRUD — there is no separate
    // allow.owner() rule on this model, because WatchlistItem has no field
    // holding a single owner the way Watchlist has ownerId. The Owner's item
    // access therefore depends entirely on being present in *this* array, even
    // though Watchlist.editors itself (addMember, membership/handler.ts) only
    // ever holds EDITOR-role userIds, never the Owner's. Fan-out has to inject
    // ownerId here, on every propagation, or the Owner silently loses read/write
    // on every item the moment any membership change fires this stream (FR-ITEM-1
    // requires the Owner be able to add/remove items always, not just before the
    // first collaborator joins).
    const itemEditors = [ownerId, ...newEditors];
    await batchPutItems(items.map((item) => ({ ...item, editors: itemEditors, viewers: newViewers })));
}

// §5.1, FR-LIST-1/5 (see the file header's point 3). One Put, not a transaction:
// the Watchlist row this reacts to is already durably written by the time the
// stream delivers it, so there is nothing to roll back if this fails other than
// retrying the same idempotent write. attribute_not_exists(watchlistId) — same
// idiom membership/handler.ts uses for its own WatchlistMember.Put — makes a
// redelivered INSERT record a no-op instead of clobbering joinedAt.
//
// createdAt/updatedAt are set explicitly, not left to Amplify Data's usual
// auto-population — that only happens inside the generated resolver, which this
// raw DynamoDB Put bypasses entirely. Amplify's generated schema marks both
// non-null, so an item missing them isn't "created without a timestamp" from
// AppSync's perspective — the whole item resolves to null on read (GraphQL
// null-propagation bubbling a missing non-null field up to its nearest nullable
// ancestor, the list entry itself), which is exactly what broke useWatchlists()
// the first time a real Watchlist.create() exercised this path end-to-end.
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

// §5.4: INSERT -> +1, REMOVE -> -1, MODIFY -> no-op (reorder/watched-toggle don't
// change membership). attribute_exists(id) guards against resurrecting a deleted
// Watchlist as a phantom {id, itemCount} row — DynamoDB's UpdateItem upserts by
// default, and a REMOVE event can arrive after the parent watchlist itself is
// already gone (e.g. a cascading list deletion, FR-LIST-4); a condition failure
// there means "nothing to update," not a real error.
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
