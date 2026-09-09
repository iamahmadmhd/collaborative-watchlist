import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { CfnResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { postConfirmation } from './functions/post-confirmation/resource';
import { claimUsername } from './functions/claim-username/resource';
import { tmdbProxy } from './functions/tmdb-proxy/resource';
import { membership } from './functions/membership/resource';
import { permissionFanout } from './functions/permission-fanout/resource';
import { deleteAccount } from './functions/delete-account/resource';

const backend = defineBackend({
    auth,
    data,
    postConfirmation,
    claimUsername,
    tmdbProxy,
    membership,
    permissionFanout,
    deleteAccount,
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
// reads Username to resolve @username -> userId for addMember (ADR-008).
//
// grantReadWriteData() is deliberately not used: it does not include
// dynamodb:TransactWriteItems, which is IAM's distinct action for that API call even
// though the transaction performs Put/Update/Delete under the hood. TransactWriteItems
// is also not sufficient BY ITSELF — DynamoDB's IAM authorization for a transaction
// checks the specific per-item action (PutItem/UpdateItem/DeleteItem) of every item in
// it, in addition to TransactWriteItems on the call as a whole (confirmed the hard way:
// AccessDeniedException on dynamodb:UpdateItem with only TransactWriteItems granted).
// Each grant below is scoped to exactly what the handler's transactions use —
// GetItem for its pre-transaction reads, then one grant per Watchlist/WatchlistMember
// item-action addMember/removeFromWatchlist/changeMemberRole actually performs
// (handler.ts: Watchlist.Update everywhere; WatchlistMember.Put on add, .Delete on
// remove/leave, .Update on a role change) — plus TransactWriteItems itself.
const watchlistTable = backend.data.resources.tables.Watchlist;
const watchlistMemberTable = backend.data.resources.tables.WatchlistMember;
const watchlistItemTable = backend.data.resources.tables.WatchlistItem;
const usernameTable = backend.data.resources.tables.Username;
const membershipLambda = backend.membership.resources.lambda;

watchlistTable.grant(membershipLambda, 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:TransactWriteItems');
watchlistMemberTable.grant(
    membershipLambda,
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:TransactWriteItems',
);
usernameTable.grant(membershipLambda, 'dynamodb:GetItem');

(membershipLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);
(membershipLambda as lambda.Function).addEnvironment('WATCHLIST_MEMBER_TABLE_NAME', watchlistMemberTable.tableName);
(membershipLambda as lambda.Function).addEnvironment('USERNAME_TABLE_NAME', usernameTable.tableName);

// NFR-COMP-2. delete-account touches seven tables directly, for the same reason
// membership does: cascade-deleting an owned watchlist and leaving a non-owned one both
// require writing Watchlist.editors/viewers, which (as above) has no GraphQL write path
// for anyone. grantReadWriteData() is avoided for the same TransactWriteItems/
// BatchWriteItem-are-distinct-actions reason membership's own comment explains; each
// grant below is scoped to exactly what delete-account/handler.ts's operations use.
const savedMovieTable = backend.data.resources.tables.SavedMovie;
const watchStatusTable = backend.data.resources.tables.WatchStatus;
const userProfileTable = backend.data.resources.tables.UserProfile;
const deleteAccountLambda = backend.deleteAccount.resources.lambda;

watchlistTable.grant(
    deleteAccountLambda,
    'dynamodb:GetItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:TransactWriteItems',
);
watchlistMemberTable.grant(
    deleteAccountLambda,
    'dynamodb:Query',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:TransactWriteItems',
);
watchlistItemTable.grant(deleteAccountLambda, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
savedMovieTable.grant(deleteAccountLambda, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
watchStatusTable.grant(deleteAccountLambda, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
userProfileTable.grant(deleteAccountLambda, 'dynamodb:GetItem', 'dynamodb:DeleteItem');
usernameTable.grant(deleteAccountLambda, 'dynamodb:DeleteItem');

// Table.grant() above only ever authorizes the base table ARN, never
// `${tableArn}/index/*` — confirmed in aws-cdk-lib's own table-grants.js: it includes
// the index ARN pattern only when the table object's `hasIndex` is true, which in turn
// only gets set on a concrete `new dynamodb.Table()` construct that tracked its own
// `.addGlobalSecondaryIndex()` calls. backend.data.resources.tables.X is a reference
// to Amplify Data's custom-resource-backed table, not that construct, so `hasIndex`
// silently defaults to false and every Query against a named GSI needs its own
// explicit grant here — same idiom as the stream ARN permissions above (a resource
// class Table.grant()'s generated policy structurally can't reach). WatchlistMember's
// byUser, SavedMovie's byUserAndDate, and WatchStatus's byUserAndList are the three
// indexes delete-account/handler.ts queries.
deleteAccountLambda.addToRolePolicy(
    new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [
            `${watchlistMemberTable.tableArn}/index/*`,
            `${savedMovieTable.tableArn}/index/*`,
            `${watchStatusTable.tableArn}/index/*`,
        ],
    }),
);

(deleteAccountLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('WATCHLIST_MEMBER_TABLE_NAME', watchlistMemberTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('WATCHLIST_ITEM_TABLE_NAME', watchlistItemTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('SAVED_MOVIE_TABLE_NAME', savedMovieTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('WATCH_STATUS_TABLE_NAME', watchStatusTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('USER_PROFILE_TABLE_NAME', userProfileTable.tableName);
(deleteAccountLambda as lambda.Function).addEnvironment('USERNAME_TABLE_NAME', usernameTable.tableName);

// Deliberately NOT done: granting userProfileTable directly to postConfirmationLambda
// (post-confirmation is grouped into the AUTH stack, not this one — resource.ts's own
// comment). The data stack already depends on the auth stack one way (defineData's
// userPool authorization mode needs the User Pool as its AppSync authorizer); a plain
// Table.grant() here would create the return edge (auth stack needing this stack's
// table ARN), and two edges between the same two stacks in opposite directions is
// exactly the CloudformationStackCircularDependencyError permission-fanout's own
// comment (above) describes for a different pair of stacks. allow.resource(fn) in
// data/resource.ts's schema-level authorization is the one mechanism here that only
// ever points this direction (data stack -> fn's stack, never the reverse) — which is
// why post-confirmation's UserProfile.create() goes through that grant instead of a
// raw table grant, unlike delete-account/membership above (both already live in this
// stack, so granting them tables from it is an intra-stack edge, not cross-stack).

// System Design §4.5, §5.4. permission-fanout consumes DynamoDB Streams on both
// Watchlist and WatchlistItem. Amplify Gen 2 does not expose stream configuration
// declaratively, so streams are enabled via the CDK escape hatch — but Amplify Data's
// default per-model tables are NOT plain CfnTable L1s, they're a Custom::AmplifyDynamoDBTable
// custom resource. cfnResources.cfnTables (keyed by logicalId) is for the plain-table
// data source strategy and is empty here; the escape hatch for the default strategy is
// cfnResources.amplifyDynamoDbTables (keyed by model name), which wraps that custom
// resource in AmplifyDynamoDbTableWrapper — see advanced-features reference in the
// amplify-workflow skill. Using cfnTables.Watchlist here previously resolved to
// undefined, so `.streamSpecification = ...` threw "Cannot set properties of undefined".
const watchlistTableWrapper = backend.data.resources.cfnResources.amplifyDynamoDbTables.Watchlist;
const watchlistItemTableWrapper = backend.data.resources.cfnResources.amplifyDynamoDbTables.WatchlistItem;
watchlistTableWrapper.streamSpecification = { streamViewType: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES };
watchlistItemTableWrapper.streamSpecification = { streamViewType: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES };

// AmplifyDynamoDbTableWrapper only exposes property *setters* for the underlying custom
// resource (it mimics Table's override ergonomics, not its read surface) — there's no
// public getter for the stream ARN the custom resource emits once streams are enabled.
// `resource` is a TS-private constructor property, not a runtime-private field, so this
// reads the exact same CfnResource the setters above mutate. It's the same
// GetAtt('TableStreamArn') call Amplify's own AmplifyDynamoDBTable construct makes
// internally when `stream` is set at construction time (see
// @aws-amplify/graphql-model-transformer's amplify-dynamodb-table-construct) — the
// table's tableStreamArn field is fixed at synth time before this override runs, so it
// stays undefined and can't be reused; this GetAtt is the only way to reach the token.
function streamArnOf(tableWrapper: typeof watchlistTableWrapper): string {
    return (tableWrapper as unknown as { resource: CfnResource }).resource.getAtt('TableStreamArn').toString();
}
const watchlistStreamArn = streamArnOf(watchlistTableWrapper);
const watchlistItemStreamArn = streamArnOf(watchlistItemTableWrapper);

const permissionFanoutLambda = backend.permissionFanout.resources.lambda;
// The DLQ and EventSourceMappings below must live in the SAME stack as the function
// itself, not a new sibling stack (backend.createStack(...) was tried first and
// produced CloudformationStackCircularDependencyError). A separate stack creates a
// two-way nested-stack dependency: EventSourceMapping.target needs the function's ARN
// (new-stack -> function-stack), while its DLQ wiring grants the function's role
// permission to send to the queue (function-stack -> new-stack) — CloudFormation can't
// order two nested stacks that depend on each other. Reusing the function's own
// auto-generated nested stack removes that second edge entirely.
const permissionFanoutStack = Stack.of(permissionFanoutLambda);
// §4.5: "Dead-letter queue required. Silent failure means stale permissions with
// nothing surfacing." One shared queue for both stream sources — same function,
// same consistency story (§4.5's own rationale for merging fan-out and itemCount
// maintenance into one consumer).
const permissionFanoutDlq = new sqs.Queue(permissionFanoutStack, 'PermissionFanoutDlq', {
    retentionPeriod: Duration.days(14),
});

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
    eventSourceArn: watchlistStreamArn,
});
new lambda.EventSourceMapping(permissionFanoutStack, 'WatchlistItemStreamMapping', {
    ...eventSourceMappingDefaults,
    eventSourceArn: watchlistItemStreamArn,
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
        resources: [watchlistStreamArn, watchlistItemStreamArn],
    }),
);
permissionFanoutLambda.addToRolePolicy(
    new iam.PolicyStatement({
        actions: ['dynamodb:ListStreams'],
        resources: ['*'],
    }),
);

// Data-plane permissions: fan-out re-queries and rewrites WatchlistItem; itemCount
// maintenance only ever updates Watchlist. Owner-membership creation (handler.ts's
// createOwnerMembership, §5.1) additionally needs a Put on WatchlistMember. No read
// access to Watchlist is needed — old/new images arrive on the stream event itself.
watchlistItemTable.grant(permissionFanoutLambda, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
watchlistTable.grant(permissionFanoutLambda, 'dynamodb:UpdateItem');
watchlistMemberTable.grant(permissionFanoutLambda, 'dynamodb:PutItem');

(permissionFanoutLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);
(permissionFanoutLambda as lambda.Function).addEnvironment('WATCHLIST_ITEM_TABLE_NAME', watchlistItemTable.tableName);
(permissionFanoutLambda as lambda.Function).addEnvironment(
    'WATCHLIST_MEMBER_TABLE_NAME',
    watchlistMemberTable.tableName,
);

export default backend;
