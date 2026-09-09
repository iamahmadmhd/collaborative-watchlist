import {
    BatchWriteCommand,
    type BatchWriteCommandInput,
    type DynamoDBDocumentClient,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';

// The document client's own request shape (native JS values), not
// @aws-sdk/client-dynamodb's WriteRequest (marshalled AttributeValues) — derived from
// BatchWriteCommandInput itself so it can't drift from what BatchWriteCommand actually accepts.
export type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];

// Shared between permission-fanout and delete-account, the two functions that page
// through a full DynamoDB Query result and/or chunk a DynamoDB BatchWriteItem call —
// same pagination loop and same 25-item-chunk/retry/backoff shape in both, previously
// duplicated verbatim (one for Puts, one for Deletes). Both callers already share the
// same idempotency story that makes retrying here safe: permission-fanout's writes are
// unconditional overwrites (§4.5's "overwrite, not delta"), delete-account's deletes are
// no-ops against an already-gone key — so backoff here is throughput contention only,
// never a correctness concern.

const BATCH_WRITE_CHUNK_SIZE = 25; // DynamoDB's hard per-call BatchWriteItem limit
const MAX_BATCH_WRITE_RETRIES = 5;

export async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface QueryAllPagesParams {
    tableName: string;
    keyConditionExpression: string;
    expressionAttributeValues: Record<string, unknown>;
    indexName?: string;
}

export async function queryAllPages(
    docClient: DynamoDBDocumentClient,
    params: QueryAllPagesParams,
): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
        const result = await docClient.send(
            new QueryCommand({
                TableName: params.tableName,
                IndexName: params.indexName,
                KeyConditionExpression: params.keyConditionExpression,
                ExpressionAttributeValues: params.expressionAttributeValues,
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );
        items.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
}

// Callers pass pre-built WriteRequests (PutRequest or DeleteRequest) — DynamoDB hands
// back unprocessed items in that same WriteRequest shape, so retries requeue them
// directly with no unwrap/rewrap step.
export async function batchWriteChunked(
    docClient: DynamoDBDocumentClient,
    tableName: string,
    requests: readonly WriteRequest[],
    callerName: string,
): Promise<void> {
    for (let i = 0; i < requests.length; i += BATCH_WRITE_CHUNK_SIZE) {
        let pending = requests.slice(i, i + BATCH_WRITE_CHUNK_SIZE);
        let attempt = 0;

        while (pending.length > 0) {
            const result = await docClient.send(
                new BatchWriteCommand({
                    RequestItems: { [tableName]: pending },
                }),
            );
            const unprocessed = result.UnprocessedItems?.[tableName];
            if (!unprocessed || unprocessed.length === 0) {
                break;
            }
            attempt += 1;
            if (attempt > MAX_BATCH_WRITE_RETRIES) {
                throw new Error(
                    `${callerName}: BatchWriteItem against ${tableName} still had ${unprocessed.length} unprocessed item(s) after ${MAX_BATCH_WRITE_RETRIES} retries`,
                );
            }
            pending = unprocessed;
            await sleep(2 ** attempt * 50); // basic exponential backoff — throughput contention only, not correctness
        }
    }
}
