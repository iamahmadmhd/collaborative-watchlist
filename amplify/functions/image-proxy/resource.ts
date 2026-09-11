import { defineFunction } from '@aws-amplify/backend';

// System Design §5.1 extension (FR-TMDB-4) — see amplify/backend.ts's ImageCacheStack
// comment for the full rationale. This function is CloudFront's origin (via a Lambda
// Function URL, IAM-authenticated, restricted to CloudFront by Origin Access Control),
// never called directly by the client.
// No resourceGroupName, deliberately: this function has no data-stack edge at all (it
// touches S3 and CloudFront only, and nothing in amplify/data/resource.ts references
// it), so Amplify's shared catch-all "function" nested stack is the right home and the
// bucket/distribution in amplify/backend.ts are created there alongside it.
//
// That is load-bearing, and it is an invariant rather than an accident: permission-fanout
// was moved OUT of this same catch-all stack (its resource.ts explains why) precisely
// because a function→data grant from here, combined with data's existing edge to
// tmdb-proxy, forms a CloudformationStackCircularDependencyError between the two stacks.
// tmdb-proxy and this function share the stack safely only because neither takes a grant
// on a data-stack resource. If image-proxy ever needs one — a DynamoDB table, an
// allow.resource() grant — it must move to resourceGroupName: 'data' in the same change,
// not afterwards.
export const imageProxy = defineFunction({
    name: 'image-proxy',
    timeoutSeconds: 10, // one upstream TMDB image fetch plus an S3 round-trip
    // Reserved concurrency is set in amplify/backend.ts via the CfnFunction escape hatch
    // (defineFunction has no prop for it) — see the NFR-SEC-3/V-10 comment there.
});
