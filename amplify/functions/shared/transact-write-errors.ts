import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

// DynamoDB reports a failed ConditionExpression as CancellationReasons[index] rather
// than a distinct error type, so callers must match on the item's position.
export function conditionalCheckFailedAt(err: unknown, index: number): boolean {
    return (
        err instanceof TransactionCanceledException &&
        err.CancellationReasons?.[index]?.Code === 'ConditionalCheckFailed'
    );
}
