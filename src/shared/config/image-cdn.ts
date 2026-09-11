import outputs from '../../../amplify_outputs.json';

// System Design §5.1 extension (FR-TMDB-4) — see amplify/backend.ts's ImageCache/ImageCdn
// comment. CloudFront (backed by image-proxy + S3) re-hosts TMDB's poster/cast-photo
// images behind our own domain, so a network that blocks image.tmdb.org directly
// doesn't also block the film artwork. FR-TMDB-4 itself is unchanged — the client still
// receives a relative path and picks the rendering size; only the domain the URL is
// built against moves.
//
// Read directly off the generated outputs file rather than through
// src/app/providers/amplify-config.ts: that module's one job is calling
// Amplify.configure() (the barrel-import exception, per its own header comment), not
// exposing arbitrary custom outputs to callers elsewhere in the app. entities/movie
// needs this value and may only import from shared (eslint-plugin-boundaries), so it
// gets its own narrow accessor here instead.
const custom = (outputs as { custom?: Record<string, unknown> }).custom;

// undefined (rather than a thrown error) when image-proxy hasn't been deployed to this
// backend yet — posterUrl() treats that exactly like a missing posterPath, falling
// back to the hatch placeholder instead of breaking every poster on the page.
export const imageCdnDomain: string | undefined =
    typeof custom?.imageCdnDomain === 'string' ? custom.imageCdnDomain : undefined;
