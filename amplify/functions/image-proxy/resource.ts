import { defineFunction } from '@aws-amplify/backend';

// System Design §5.1 extension (FR-TMDB-4) — see amplify/backend.ts's ImageCacheStack
// comment for the full rationale. This function is CloudFront's origin (via a Lambda
// Function URL, IAM-authenticated, restricted to CloudFront by Origin Access Control),
// never called directly by the client.
export const imageProxy = defineFunction({
    name: 'image-proxy',
    timeoutSeconds: 10, // one upstream TMDB image fetch plus an S3 round-trip
});
