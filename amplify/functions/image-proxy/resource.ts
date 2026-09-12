import { defineFunction } from '@aws-amplify/backend';

// CloudFront's origin for cached TMDB artwork, reached through an IAM-authenticated
// Function URL and never called directly by the client. The bucket, distribution and
// its reserved concurrency are all created in backend.ts.
//
// No resourceGroupName, deliberately: this function touches only S3 and CloudFront, so
// the catch-all stack is safe for it. If it ever needs a data-stack resource it must
// move to 'data' in the same change — see System Design §4.6.
export const imageProxy = defineFunction({
    name: 'image-proxy',
    timeoutSeconds: 10, // one upstream TMDB image fetch plus an S3 round-trip
});
