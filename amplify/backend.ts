import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
// TODO: import function resources once implemented:
// import { postConfirmation } from "./functions/post-confirmation/resource";
// import { tmdbProxy } from "./functions/tmdb-proxy/resource";
// import { membership } from "./functions/membership/resource";
// import { claimHandle } from "./functions/claim-handle/resource";
// import { permissionFanout } from "./functions/permission-fanout/resource";

const backend = defineBackend({
    auth,
    data,
    // postConfirmation, tmdbProxy, membership, claimHandle, permissionFanout,
});

// TODO (System Design §4.5): CDK escape hatch to enable a DynamoDB stream on the
// Watchlist table and wire permission-fanout as its consumer. Amplify Gen 2 does not
// expose stream configuration declaratively — reach the underlying CFN table via
// backend.data.resources.tables.Watchlist and attach the stream + Lambda event source
// here. Requires a dead-letter queue (§4.5) — do not skip it.

export default backend;
