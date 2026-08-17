import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { postConfirmation } from './functions/post-confirmation/resource';
import { claimHandle } from './functions/claim-handle/resource';
import { tmdbProxy } from './functions/tmdb-proxy/resource';
import { membership } from './functions/membership/resource';
import { permissionFanout } from './functions/permission-fanout/resource';

const backend = defineBackend({
    auth,
    data,
    postConfirmation,
    claimHandle,
    tmdbProxy,
    membership,
    permissionFanout,
});

// System Design §5.5, ADR-007. Plain CDK, not an Amplify Data model — TmdbCache must
// never appear in the GraphQL schema (only tmdb-proxy touches it, over IAM, not AppSync).
// DESTROY is deliberate: this table holds nothing but disposable TMDB response cache,
// re-populated on the next miss — not user data, so no retention concern on stack teardown.
const tmdbCacheStack = backend.createStack('TmdbCacheStack');
const tmdbCacheTable = new dynamodb.Table(tmdbCacheStack, 'TmdbCache', {
    partitionKey: { name: 'cacheKey', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // §5.6 — on-demand throughout
    timeToLiveAttribute: 'expiresAt',
    removalPolicy: RemovalPolicy.DESTROY,
});
tmdbCacheTable.grantReadWriteData(backend.tmdbProxy.resources.lambda);
// resources.lambda is typed as the CDK IFunction interface, which doesn't expose
// addEnvironment (that's Function-specific). defineFunction always constructs a
// concrete aws-cdk-lib/aws-lambda Function under the hood, so this cast is safe.
(backend.tmdbProxy.resources.lambda as lambda.Function).addEnvironment(
    'TMDB_CACHE_TABLE_NAME',
    tmdbCacheTable.tableName,
);

// System Design §4.2, §4.4, §4.5, FR-MEM-8. membership writes Watchlist and
// WatchlistMember atomically via DynamoDB TransactWriteItems — AppSync/Amplify Data
// has no transactional multi-model mutation, so this bypasses the generated
// resolvers for its actual writes entirely (see membership/handler.ts). It also
// reads Handle to resolve @handle -> userId for addMember (ADR-008).
//
// grantReadWriteData() is deliberately not used: it does not include
// dynamodb:TransactWriteItems, which is IAM's distinct action for that API call even
// though the transaction performs Put/Update/Delete under the hood. Each grant below
// is scoped to exactly what the handler calls — GetItem for its pre-transaction reads,
// TransactWriteItems for the atomic write, nothing else.
const watchlistTable = backend.data.resources.tables.Watchlist;
const watchlistMemberTable = backend.data.resources.tables.WatchlistMember;
const watchlistItemTable = backend.data.resources.tables.WatchlistItem;
const handleTable = backend.data.resources.tables.Handle;
const membershipLambda = backend.membership.resources.lambda;

watchlistTable.grant(membershipLambda, 'dynamodb:GetItem', 'dynamodb:TransactWriteItems');
watchlistMemberTable.grant(membershipLambda, 'dynamodb:TransactWriteItems');
handleTable.grant(membershipLambda, 'dynamodb:GetItem');

(membershipLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);
(membershipLambda as lambda.Function).addEnvironment('WATCHLIST_MEMBER_TABLE_NAME', watchlistMemberTable.tableName);
(membershipLambda as lambda.Function).addEnvironment('HANDLE_TABLE_NAME', handleTable.tableName);

// System Design §4.5, §5.4. permission-fanout consumes DynamoDB Streams on both
// Watchlist and WatchlistItem. Amplify Gen 2 does not expose stream configuration
// declaratively, so streams are enabled via the CDK escape hatch on each table's L1
// CfnTable — mutating .streamSpecification here changes the synthesized template
// even though the object was created by Amplify's construct, not directly by us.
const watchlistCfnTable = backend.data.resources.cfnResources.cfnTables.Watchlist;
const watchlistItemCfnTable = backend.data.resources.cfnResources.cfnTables.WatchlistItem;
watchlistCfnTable.streamSpecification = { streamViewType: 'NEW_AND_OLD_IMAGES' };
watchlistItemCfnTable.streamSpecification = { streamViewType: 'NEW_AND_OLD_IMAGES' };

const permissionFanoutStack = backend.createStack('PermissionFanoutStack');
// §4.5: "Dead-letter queue required. Silent failure means stale permissions with
// nothing surfacing." One shared queue for both stream sources — same function,
// same consistency story (§4.5's own rationale for merging fan-out and itemCount
// maintenance into one consumer).
const permissionFanoutDlq = new sqs.Queue(permissionFanoutStack, 'PermissionFanoutDlq', {
    retentionPeriod: Duration.days(14),
});

const permissionFanoutLambda = backend.permissionFanout.resources.lambda;

const eventSourceMappingDefaults = {
    target: permissionFanoutLambda,
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 25, // matches the fan-out chunk size (§4.5) — no reason to poll larger batches
    bisectBatchOnError: true, // isolates a poison-pill record instead of blocking the whole batch
    retryAttempts: 3,
    // Lets a failure in one record report just that record as failed (handler.ts
    // returns batchItemFailures), so Lambda doesn't re-run already-succeeded writes
    // in the same batch on retry — important given fan-out's BatchWriteItem calls
    // aren't individually idempotency-guarded beyond "overwrite, not delta."
    reportBatchItemFailures: true,
    onFailure: new SqsDlq(permissionFanoutDlq),
};

new lambda.EventSourceMapping(permissionFanoutStack, 'WatchlistStreamMapping', {
    ...eventSourceMappingDefaults,
    eventSourceArn: watchlistCfnTable.attrStreamArn,
});
new lambda.EventSourceMapping(permissionFanoutStack, 'WatchlistItemStreamMapping', {
    ...eventSourceMappingDefaults,
    eventSourceArn: watchlistItemCfnTable.attrStreamArn,
});

// Stream-read permissions aren't covered by Table.grant()/grantReadWriteData() (those
// govern the table's data plane, not its stream) — granted directly on both stream
// ARNs, matching the exact action set CDK's own Table.grantStreamRead() uses.
// ListStreams has no resource-level granularity (it lists streams for a table by
// name, not by stream ARN), so it's granted separately on '*', same as AWS's managed
// AWSLambdaDynamoDBExecutionRole policy does.
permissionFanoutLambda.addToRolePolicy(
    new iam.PolicyStatement({
        actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator'],
        resources: [watchlistCfnTable.attrStreamArn, watchlistItemCfnTable.attrStreamArn],
    }),
);
permissionFanoutLambda.addToRolePolicy(
    new iam.PolicyStatement({
        actions: ['dynamodb:ListStreams'],
        resources: ['*'],
    }),
);

// Data-plane permissions: fan-out re-queries and rewrites WatchlistItem; itemCount
// maintenance only ever updates Watchlist. No read access to Watchlist is needed —
// old/new images arrive on the stream event itself.
watchlistItemTable.grant(permissionFanoutLambda, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
watchlistTable.grant(permissionFanoutLambda, 'dynamodb:UpdateItem');

(permissionFanoutLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);
(permissionFanoutLambda as lambda.Function).addEnvironment('WATCHLIST_ITEM_TABLE_NAME', watchlistItemTable.tableName);

export default backend;
