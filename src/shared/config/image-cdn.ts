import outputs from '../../../amplify_outputs.json';

// The domain of the CloudFront distribution that re-hosts TMDB artwork.
//
// Read directly off the generated outputs file rather than through
// app/providers/amplify-config.ts, whose one job is calling Amplify.configure().
// entities/movie needs this value and may only import from shared, so it gets its own
// narrow accessor here.
const custom = (outputs as { custom?: Record<string, unknown> }).custom;

// undefined rather than a thrown error when image-proxy has not been deployed yet:
// posterUrl() then treats it like a missing posterPath and falls back to the
// placeholder, instead of breaking every poster on the page.
export const imageCdnDomain: string | undefined =
    typeof custom?.imageCdnDomain === 'string' ? custom.imageCdnDomain : undefined;
