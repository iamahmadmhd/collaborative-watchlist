import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

// Shared between membership and delete-account, the two functions that submit a
// TransactWriteCommand and need to know which item in it failed its
// ConditionExpression — DynamoDB reports that as CancellationReasons[index], not as a
// distinct error type per item, so both handlers were checking this identically.
export function conditionalCheckFailedAt(err: unknown, index: number): boolean {
    return (
        err instanceof TransactionCanceledException &&
        err.CancellationReasons?.[index]?.Code === 'ConditionalCheckFailed'
    );
}
