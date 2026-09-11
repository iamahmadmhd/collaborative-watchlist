import {
    BatchWriteCommand,
    type BatchWriteCommandInput,
    type DynamoDBDocumentClient,
    QueryCommand,
} from '@aws-sdk/lib-dynamodb';

// The document client's request shape (native JS values), not client-dynamodb's
// marshalled WriteRequest. Derived from BatchWriteCommandInput so it cannot drift.
export type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];

// Shared by permission-fanout and delete-account. Retrying here is safe because both
// callers' writes are idempotent — unconditional overwrites in one, deletes of
// already-absent keys in the other — so backoff is a throughput concern only.

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

// DynamoDB returns unprocessed items in the same WriteRequest shape callers pass in,
// so a retry requeues them directly.
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
