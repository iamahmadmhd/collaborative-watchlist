import { defineBackend } from '@aws-amplify/backend';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { CfnResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { postConfirmation } from './functions/post-confirmation/resource';
import { claimUsername } from './functions/claim-username/resource';
import { tmdbProxy } from './functions/tmdb-proxy/resource';
import { imageProxy } from './functions/image-proxy/resource';
import { membership } from './functions/membership/resource';
import { permissionFanout } from './functions/permission-fanout/resource';
import { deleteAccount } from './functions/delete-account/resource';
import { watchlistItem } from './functions/watchlist-item/resource';

const backend = defineBackend({
    auth,
    data,
    postConfirmation,
    claimUsername,
    tmdbProxy,
    imageProxy,
    membership,
    permissionFanout,
    deleteAccount,
    watchlistItem,
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

// System Design §5.1 extension (FR-TMDB-4), scope decision 2026-09-10: some members
// cannot reach image.tmdb.org directly (network-level block reported against TMDB's
// CDN), so posters/cast photos are re-hosted behind our own CloudFront distribution,
// backed by image-proxy (download-on-miss, cache in S3, serve from S3 thereafter).
// FR-TMDB-4 itself is unchanged — the client still receives a relative path and
// picks the rendering size; only the domain posterUrl() builds against changes.
//
// Everything below lives in image-proxy's own auto-generated nested stack, not a new
// sibling stack (backend.createStack(...) was tried first here too and hit the same
// CloudformationStackCircularDependencyError permissionFanoutStack's comment above
// describes: the bucket grant needs the function's role, in this hypothetical new
// stack it would need the function's stack, and the distribution needs the Function
// URL, also in the function's stack — two edges between the same two stacks in
// opposite directions). Reusing Stack.of(imageProxyLambda) keeps every resource that
// references the others in one stack, so neither edge is ever cross-stack.
const imageProxyLambda = backend.imageProxy.resources.lambda;
const imageProxyStack = Stack.of(imageProxyLambda);

// DESTROY + autoDeleteObjects, same reasoning as TmdbCache above: this bucket holds
// nothing but disposable re-fetchable TMDB image bytes, not user data. The lifecycle
// rule is a bound on staleness, not a correctness requirement — TMDB image paths are
// content-addressed, so a cached object never goes wrong, only (rarely) outdated.
const imageCacheBucket = new s3.Bucket(imageProxyStack, 'ImageCache', {
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    lifecycleRules: [{ expiration: Duration.days(90) }],
});
imageCacheBucket.grantReadWrite(imageProxyLambda);
(imageProxyLambda as lambda.Function).addEnvironment('IMAGE_CACHE_BUCKET_NAME', imageCacheBucket.bucketName);

// AWS_IAM, not NONE: this Function URL is never called by the browser, only by
// CloudFront via Origin Access Control (below) — see handler.ts's own header comment.
const imageProxyFunctionUrl = imageProxyLambda.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.AWS_IAM,
    invokeMode: lambda.InvokeMode.BUFFERED,
});

// FunctionUrlOrigin.withOriginAccessControl creates the OAC and adds a CfnPermission
// for lambda:InvokeFunctionUrl itself (its own bind() does that) — but that grant alone
// is NOT sufficient: CloudFront's signed origin request to a Function URL is rejected
// with 403 until the function also allows lambda:InvokeFunction from the CloudFront
// service principal. Confirmed the hard way against a real deployment. The explicit
// addPermission below is therefore required, not redundant with the construct's grant;
// it is scoped by sourceArn to this one distribution so it isn't a blanket
// "any CloudFront distribution may invoke this function" grant.
//
// errorResponses sets CloudFront's Error Caching Minimum TTL per status. Without it
// CloudFront caches a 404 for 10 seconds by default, so every repeat request for an
// image TMDB doesn't have re-invokes this Lambda and re-hits image.tmdb.org —
// handler.ts deliberately does not persist a failure to S3, so the origin has no
// memory of its own. 502 is kept short: that one IS transient.
const imageCdn = new cloudfront.Distribution(imageProxyStack, 'ImageCdn', {
    comment: 'TMDB image cache/proxy (System Design §5.1 extension, FR-TMDB-4)',
    defaultBehavior: {
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(imageProxyFunctionUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    errorResponses: [
        { httpStatus: 404, ttl: Duration.minutes(10) },
        { httpStatus: 502, ttl: Duration.seconds(30) },
    ],
});

imageProxyLambda.addPermission('AllowCloudFrontInvokeFunction', {
    principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
    action: 'lambda:InvokeFunction',
    sourceArn: `arn:aws:cloudfront::${imageProxyStack.account}:distribution/${imageCdn.distributionId}`,
});

// NFR-SEC-3 / V-10, UNRESOLVED — flagged, not silently answered. This distribution is
// the app's one publicly reachable, unauthenticated surface: no Cognito token, no WAF,
// no per-principal throttle. V-10 as written ("Every TMDB-backed operation rejects an
// unauthenticated caller at the API layer") and NFR-SEC-3's "authentication endpoints,
// as the only remaining unauthenticated surface" both predate FR-TMDB-8, and v1.6
// amended neither — so either those two need a carve-out for opaque public artwork
// (defensible: no user data crosses this path) or this surface needs closing. That is a
// requirements decision, not one to make here.
//
// What IS applied here regardless of how that lands, because it is correct either way:
// a reserved-concurrency ceiling. A flood of well-formed but nonexistent image paths
// (the pattern in handler.ts admits any [a-zA-Z0-9]+ hash, and each one is a distinct
// CloudFront cache key, so edge caching does not absorb it) would otherwise scale
// one-to-one into Lambda invocations and outbound image.tmdb.org requests — the exact
// quota exhaustion NFR-SEC-3 exists to prevent. This caps that at 25 concurrent
// executions AND guarantees image-proxy those 25, so the reverse failure — a flood here
// consuming the account's unreserved pool and starving membership, tmdb-proxy or
// delete-account — can't happen either.
//
// A WAF rate-based rule is the missing piece and is deliberately NOT added here: a
// WAFv2 ACL for CloudFront must be created with scope CLOUDFRONT in us-east-1, and
// Amplify Gen 2 gives no way to place a stack in a different region from the rest of
// the backend (backend.createStack() is a nested stack, same region). Adding one from
// this file would break `ampx sandbox`/deploy outright for any app not already in
// us-east-1. It needs a separate us-east-1 stack wired by ACL ARN.
backend.imageProxy.resources.cfnResources.cfnFunction.reservedConcurrentExecutions = 25;

// Consumed by src/shared/config/image-cdn.ts, mirroring how amplify_outputs.json
// already carries every other frontend-facing backend value — no new frontend config
// mechanism, just a new key in the existing one.
backend.addOutput({
    custom: {
        imageCdnDomain: imageCdn.distributionDomainName,
    },
});

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

// FR-ITEM-1, ADR-001. watchlist-item reads the parent Watchlist before creating an
// item, so it can stamp editors/viewers from the authoritative row rather than from
// the request (see that function's resource.ts). GetItem only — its write goes back
// through AppSync under the schema-level allow.resource() grant, not through this
// table reference, because that is what publishes the subscription event /lists/:id
// depends on (§2.4).
const watchlistItemLambda = backend.watchlistItem.resources.lambda;
watchlistTable.grant(watchlistItemLambda, 'dynamodb:GetItem');
(watchlistItemLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);

// FR-AUTH-4 / NFR-SEC-7. claim-username reads UserProfile and writes UserProfile.username
// directly rather than through the generated resolvers — that field carries its own
// field-level authorization rule (data/resource.ts) so that no member can rewrite their
// own handle, and allow.resource() has no field-level form to exempt this function from
// it. Same intra-stack situation as membership/delete-account above: claim-username is
// already resourceGroupName: 'data', so granting it a data-stack table is not a
// cross-stack edge. Its Username.create()/delete() calls still go over AppSync.
const claimUsernameLambda = backend.claimUsername.resources.lambda;
userProfileTable.grant(claimUsernameLambda, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
(claimUsernameLambda as lambda.Function).addEnvironment('USER_PROFILE_TABLE_NAME', userProfileTable.tableName);

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
