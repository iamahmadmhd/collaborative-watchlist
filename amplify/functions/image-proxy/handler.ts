import type { LambdaFunctionURLHandler } from 'aws-lambda';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Serves cached TMDB artwork. CloudFront is the only caller, so this never sees a
// direct browser request. Requests arrive shaped like the client's own posterUrl()
// output — /{size}{tmdbImagePath}, e.g. /w185/kqjL17yufvn9OVLyXYpvtyrFfak.jpg.

const s3 = new S3Client({});
const BUCKET_NAME = process.env.IMAGE_CACHE_BUCKET_NAME!;

// The only two sizes posterUrl() ever requests. Rejecting anything else keeps this
// from becoming an open fetch-any-path-at-any-size proxy.
const ALLOWED_SIZES = new Set(['w185', 'w500']);

// TMDB image paths are a flat hash filename, never a subdirectory. Anchoring the
// pattern this tightly is the SSRF guard: a looser one would let a crafted path smuggle
// query strings or traversal segments into the upstream fetch.
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

// TMDB image paths are content-addressed, so a hit can be treated as immutable.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Nothing is written to S3 on a failed fetch, so without this the origin has no memory
// of a bad path and every repeat request re-invokes this function. Ten minutes absorbs
// a page full of repeats while still picking up a poster TMDB adds later. CloudFront's
// error TTL is set to match in backend.ts; the two are configured independently and
// only the pair covers both edge and browser.
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
        // Deliberately not written to S3: the short cache-control above keeps repeats
        // off this function without leaving a tombstone object to expire.
        if (upstream.status === 404) {
            return notFoundResponse();
        }
        // A 5xx from TMDB is transient; caching it for ten minutes would turn a blip
        // into an outage, so it gets no cache-control of its own.
        return { statusCode: 502, body: 'Image unavailable' };
    }
    const contentType = upstream.headers.get('content-type') ?? contentTypeFor(imagePath);
    const bytes = new Uint8Array(await upstream.arrayBuffer());

    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Body: bytes, ContentType: contentType }));

    return imageResponse(bytes, contentType);
};
