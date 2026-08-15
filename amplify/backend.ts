import { defineBackend } from '@aws-amplify/backend';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { postConfirmation } from './functions/post-confirmation/resource';
import { claimHandle } from './functions/claim-handle/resource';
import { tmdbProxy } from './functions/tmdb-proxy/resource';
// TODO: import remaining function resources once implemented:
// import { membership } from "./functions/membership/resource";
// import { permissionFanout } from "./functions/permission-fanout/resource";

const backend = defineBackend({
    auth,
    data,
    postConfirmation,
    claimHandle,
    tmdbProxy,
    // membership, permissionFanout,
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

// TODO (System Design §4.5): CDK escape hatch to enable a DynamoDB stream on the
// Watchlist table and wire permission-fanout as its consumer. Amplify Gen 2 does not
// expose stream configuration declaratively — reach the underlying CFN table via
// backend.data.resources.tables.Watchlist and attach the stream + Lambda event source
// here. Requires a dead-letter queue (§4.5) — do not skip it.

export default backend;
