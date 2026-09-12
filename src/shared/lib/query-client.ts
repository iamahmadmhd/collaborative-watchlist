import { QueryClient } from '@tanstack/react-query';

// A single instance every layer above shared can reach. The React binding is composed
// in the `_app` route group rather than here, so this module and aws-amplify/api stay
// out of the eager auth-shell chunk.
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // TMDB responses are already cached server-side per query type, so a short
            // client staleTime avoids refetching on remount without fighting that cache.
            staleTime: 60_000,
            retry: 1,
        },
    },
});
