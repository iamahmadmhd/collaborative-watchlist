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

// Plain CDK, not an Amplify Data model: TmdbCache must not appear in the GraphQL
// schema. DESTROY is safe — the table holds only re-fetchable TMDB responses.
const tmdbCacheStack = backend.createStack('TmdbCacheStack');
const tmdbCacheTable = new dynamodb.Table(tmdbCacheStack, 'TmdbCache', {
    partitionKey: { name: 'cacheKey', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'expiresAt',
    removalPolicy: RemovalPolicy.DESTROY,
});
tmdbCacheTable.grantReadWriteData(backend.tmdbProxy.resources.lambda);
// resources.lambda is typed as IFunction, which has no addEnvironment. defineFunction
// always builds a concrete Function underneath, so the cast is safe (repeated below).
(backend.tmdbProxy.resources.lambda as lambda.Function).addEnvironment(
    'TMDB_CACHE_TABLE_NAME',
    tmdbCacheTable.tableName,
);

// The image CDN lives in image-proxy's own nested stack, not a new sibling stack: the
// bucket grant and the distribution both reference resources in the function's stack,
// while the function's role references the bucket — two nested stacks pointing at each
// other, which CloudFormation cannot order.
const imageProxyLambda = backend.imageProxy.resources.lambda;
const imageProxyStack = Stack.of(imageProxyLambda);

// The lifecycle rule bounds staleness rather than enforcing correctness: TMDB image
// paths are content-addressed, so a cached object is never wrong, only superseded.
const imageCacheBucket = new s3.Bucket(imageProxyStack, 'ImageCache', {
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    lifecycleRules: [{ expiration: Duration.days(90) }],
});
imageCacheBucket.grantReadWrite(imageProxyLambda);
(imageProxyLambda as lambda.Function).addEnvironment('IMAGE_CACHE_BUCKET_NAME', imageCacheBucket.bucketName);

// AWS_IAM, not NONE: the browser never calls this URL, only CloudFront via OAC.
const imageProxyFunctionUrl = imageProxyLambda.addFunctionUrl({
    authType: lambda.FunctionUrlAuthType.AWS_IAM,
    invokeMode: lambda.InvokeMode.BUFFERED,
});

// errorResponses raises CloudFront's error-caching TTL: the default 10 seconds means
// every repeat request for an image TMDB doesn't have re-invokes this Lambda, since
// the handler deliberately never persists a failure to S3. 502 stays short.
const imageCdn = new cloudfront.Distribution(imageProxyStack, 'ImageCdn', {
    comment: 'TMDB image cache/proxy',
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

// Required in addition to the OAC grant withOriginAccessControl() adds itself: without
// lambda:InvokeFunction for the CloudFront principal the signed origin request 403s.
// Scoped by sourceArn so it is not a blanket grant to every distribution.
imageProxyLambda.addPermission('AllowCloudFrontInvokeFunction', {
    principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
    action: 'lambda:InvokeFunction',
    sourceArn: `arn:aws:cloudfront::${imageProxyStack.account}:distribution/${imageCdn.distributionId}`,
});

// A flood of well-formed but nonexistent image paths gets a distinct CloudFront cache
// key each, so the edge absorbs none of it. This caps the blast radius at 25 concurrent
// executions and simultaneously reserves those 25, so such a flood can neither exhaust
// the TMDB quota nor starve the other functions of the account's unreserved pool.
// See System Design §4.6 for the WAF rule this does not replace.
backend.imageProxy.resources.cfnResources.cfnFunction.reservedConcurrentExecutions = 25;

// Read by src/shared/config/image-cdn.ts out of amplify_outputs.json.
backend.addOutput({
    custom: {
        imageCdnDomain: imageCdn.distributionDomainName,
    },
});

// grantReadWriteData() is not usable for the transactional functions below: it omits
// dynamodb:TransactWriteItems, and that action alone is not sufficient either —
// DynamoDB authorizes a transaction against the per-item action (PutItem/UpdateItem/
// DeleteItem) of every item in it as well as the call itself. Each grant is therefore
// scoped to exactly the actions its handler performs.
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

// delete-account writes seven tables directly: both cascade-deleting an owned watchlist
// and leaving someone else's require writing Watchlist.editors/viewers, which has no
// GraphQL write path for anyone.
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

// Table.grant() only authorizes the base table ARN: it adds `${tableArn}/index/*` only
// when the table tracked its own addGlobalSecondaryIndex() calls, which a reference to
// an Amplify Data table never does. Every GSI query needs its own grant.
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

// watchlist-item reads the parent Watchlist to stamp editors/viewers from the
// authoritative row. GetItem only — its write goes back through AppSync under the
// schema-level allow.resource() grant, which is what publishes the subscription event.
const watchlistItemLambda = backend.watchlistItem.resources.lambda;
watchlistTable.grant(watchlistItemLambda, 'dynamodb:GetItem');
(watchlistItemLambda as lambda.Function).addEnvironment('WATCHLIST_TABLE_NAME', watchlistTable.tableName);

// claim-username writes UserProfile.username directly because that field's own
// authorization rule denies every GraphQL writer and allow.resource() has no
// field-level form to exempt it. Its Username.create()/delete() still go over AppSync.
const claimUsernameLambda = backend.claimUsername.resources.lambda;
userProfileTable.grant(claimUsernameLambda, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
(claimUsernameLambda as lambda.Function).addEnvironment('USER_PROFILE_TABLE_NAME', userProfileTable.tableName);

// post-confirmation deliberately gets no table grant here: it lives in the auth stack,
// which the data stack already depends on, so granting it a data-stack table would
// close a cycle. It writes through allow.resource() in data/resource.ts instead.

// Amplify Gen 2 exposes no declarative stream configuration, so streams are enabled
// through the escape hatch. It must be amplifyDynamoDbTables (keyed by model name):
// Amplify Data's default tables are a Custom::AmplifyDynamoDBTable resource, so
// cfnResources.cfnTables — the plain-table strategy's map — is empty here.
const watchlistTableWrapper = backend.data.resources.cfnResources.amplifyDynamoDbTables.Watchlist;
const watchlistItemTableWrapper = backend.data.resources.cfnResources.amplifyDynamoDbTables.WatchlistItem;
watchlistTableWrapper.streamSpecification = { streamViewType: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES };
watchlistItemTableWrapper.streamSpecification = { streamViewType: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES };

// The wrapper exposes only setters, with no getter for the stream ARN the custom
// resource emits. `resource` is TS-private but not runtime-private, so this reaches the
// same CfnResource the setters mutate. The table's own tableStreamArn is fixed at synth
// time before this override runs and stays undefined, so this GetAtt is the only route.
function streamArnOf(tableWrapper: typeof watchlistTableWrapper): string {
    return (tableWrapper as unknown as { resource: CfnResource }).resource.getAtt('TableStreamArn').toString();
}
const watchlistStreamArn = streamArnOf(watchlistTableWrapper);
const watchlistItemStreamArn = streamArnOf(watchlistItemTableWrapper);

const permissionFanoutLambda = backend.permissionFanout.resources.lambda;
// The DLQ and event source mappings must share the function's own stack: in a sibling
// stack the mapping would reference the function's ARN while the function's role
// references the queue, and CloudFormation cannot order two mutually dependent stacks.
const permissionFanoutStack = Stack.of(permissionFanoutLambda);
// Without a DLQ a failed fan-out leaves stale permissions with nothing surfacing.
// One queue for both stream sources.
const permissionFanoutDlq = new sqs.Queue(permissionFanoutStack, 'PermissionFanoutDlq', {
    retentionPeriod: Duration.days(14),
});

const eventSourceMappingDefaults = {
    target: permissionFanoutLambda,
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 25, // matches the fan-out chunk size
    bisectBatchOnError: true, // isolate a poison-pill record instead of blocking the batch
    retryAttempts: 3,
    // The handler returns batchItemFailures, so a retry re-runs only the failed records
    // rather than the whole batch.
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

// Table.grant() covers the data plane, not the stream. ListStreams has no
// resource-level granularity, so it goes on '*' as AWS's own managed policy does.
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

// No read access to Watchlist is needed — old and new images arrive on the event.
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
