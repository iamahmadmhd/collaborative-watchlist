import { QueryClient } from '@tanstack/react-query';

// System Design §2.2 / CLAUDE.md module structure: shared/lib owns "amplify
// client, queryClient, hooks" — a single instance every layer above shared can
// reach (features' mutations call `queryClient.invalidateQueries` in
// `onSuccess`, entities' queries are keyed against it). The React binding
// (`QueryClientProvider`) is composed where the tree is assembled — the `_app`
// route group — not here; this module only owns the instance, imported once by
// that route so it and `aws-amplify/api` stay out of the eager auth-shell chunk
// (NFR-PERF-4, System Design §2.6).
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // TMDB responses are already cached server-side per query-type TTL
            // (System Design §5.5) — a short client staleTime avoids refetching
            // the same page on every remount without fighting that cache.
            staleTime: 60_000,
            retry: 1,
        },
    },
});
