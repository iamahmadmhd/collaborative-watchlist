import type { LambdaFunctionURLHandler } from 'aws-lambda';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// image-proxy — System Design §5.1 extension (FR-TMDB-4), amplify/backend.ts's
// ImageCacheStack comment.
//
// CloudFront is the only caller (via a Function URL restricted to CloudFront by Origin
// Access Control), so this never sees a direct browser request. Requests arrive shaped
// exactly like the client's own posterUrl() output: /{size}{tmdbImagePath}, e.g.
// /w185/kqjL17yufvn9OVLyXYpvtyrFfak.jpg — the same {size, path} pair TMDB's own image
// CDN takes, just re-hosted behind our own domain so a network that blocks
// image.tmdb.org doesn't also block the film's artwork.

const s3 = new S3Client({});
const BUCKET_NAME = process.env.IMAGE_CACHE_BUCKET_NAME!;

// Mirrors src/entities/movie/model/movie.ts's posterUrl() — the only two sizes the
// client ever requests (w185 grid/cast cards, w500 movie-detail). Rejecting anything
// else keeps this from becoming an open fetch-any-path-at-any-size proxy.
const ALLOWED_SIZES = new Set(['w185', 'w500']);

// TMDB image paths are a flat hash filename, never a subdirectory (confirmed against
// every posterPath/profilePath this app has stored). Anchoring the pattern this tightly
// is the SSRF guard: without it, a crafted path could smuggle query strings or
// traversal segments into the upstream TMDB fetch below.
const IMAGE_PATH_PATTERN = /^\/[a-zA-Z0-9]+\.(jpg|jpeg|png)$/;

interface ParsedRequest {
    size: string;
    imagePath: string;
    s3Key: string;
}

function parseRequestPath(rawPath: string): ParsedRequest | null {
    const separatorIndex = rawPath.indexOf('/', 1);
    if (separatorIndex === -1) {
        return null;
    }
    const size = rawPath.slice(1, separatorIndex);
    const imagePath = rawPath.slice(separatorIndex);
    if (!ALLOWED_SIZES.has(size) || !IMAGE_PATH_PATTERN.test(imagePath)) {
        return null;
    }
    return { size, imagePath, s3Key: `${size}${imagePath}` };
}

function contentTypeFor(imagePath: string): string {
    return imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

// TMDB image paths are content-addressed — the same path never changes what image it
// points to, so both S3 and the CloudFront edge in front of this function can treat a
// hit as immutable for a long time rather than re-validating.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Negative responses carry their own, much shorter cache directive. Nothing is written
// to S3 on a miss-then-failure (see the handler), so without this the origin has no
// memory of a bad path at all and every repeat request re-invokes this function and
// re-hits image.tmdb.org. Ten minutes is long enough to absorb a page full of repeats
// and short enough that a poster TMDB adds later appears without a deploy. CloudFront's
// own Error Caching Minimum TTL is set to match in backend.ts — both, because the two
// are configured independently and only the pair covers edge and browser alike.
const CACHE_CONTROL_NEGATIVE = 'public, max-age=600';

function imageResponse(body: Uint8Array, contentType: string) {
    return {
        statusCode: 200,
        headers: { 'content-type': contentType, 'cache-control': CACHE_CONTROL },
        body: Buffer.from(body).toString('base64'),
        isBase64Encoded: true,
    };
}

function notFoundResponse() {
    return {
        statusCode: 404,
        headers: { 'cache-control': CACHE_CONTROL_NEGATIVE },
        body: 'Not found',
    };
}

export const handler: LambdaFunctionURLHandler = async (event) => {
    const parsed = parseRequestPath(event.rawPath);
    if (!parsed) {
        return notFoundResponse();
    }
    const { size, imagePath, s3Key } = parsed;

    try {
        const cached = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
        const bytes = await cached.Body!.transformToByteArray();
        return imageResponse(bytes, cached.ContentType ?? contentTypeFor(imagePath));
    } catch (error) {
        if (!(error instanceof NoSuchKey)) {
            throw error;
        }
    }

    const upstream = await fetch(`https://image.tmdb.org/t/p/${size}${imagePath}`);
    if (!upstream.ok) {
        // Still not written to S3 — a missing/removed TMDB image is not this proxy's
        // problem to remember durably. The short cache-control above (and CloudFront's
        // matching error TTL) is what keeps a repeat request for the same bad path off
        // both this function and image.tmdb.org, without a tombstone object to expire.
        if (upstream.status === 404) {
            return notFoundResponse();
        }
        // A 5xx from TMDB is transient; caching it for ten minutes would turn a blip
        // into an outage, so this one gets no cache-control of its own (backend.ts
        // caps it at CloudFront's 30-second error TTL).
        return { statusCode: 502, body: 'Image unavailable' };
    }
    const contentType = upstream.headers.get('content-type') ?? contentTypeFor(imagePath);
    const bytes = new Uint8Array(await upstream.arrayBuffer());

    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Body: bytes, ContentType: contentType }));

    return imageResponse(bytes, contentType);
};
