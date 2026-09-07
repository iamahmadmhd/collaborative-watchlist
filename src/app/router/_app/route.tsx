import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { fetchAuthSession } from 'aws-amplify/auth';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../shared/lib/query-client';

// Route guards (v1.1), CLAUDE.md / FR-DISC-6. Every route outside the auth
// group (`_auth/**`) sits under this one pathless parent, so the check runs
// once rather than per-route — the same fetchAuthSession()/tokens pattern
// `_auth/set-username.tsx` used as its documented stand-in while this was
// deferred (its own comment says so). beforeLoad's async nature *is* the
// "session not yet resolved" state: the router shows the pending state while
// this promise is in flight and only redirects once it has actually resolved
// to "no tokens" — it never conflates the two by redirecting eagerly.
// Presentational only, like useWatchlistRole: AppSync enforces auth regardless
// of whether this check runs at all (NFR-SEC-1).
//
// QueryClientProvider is composed here, not in __root.tsx, on purpose: this
// route (and everything under it) is its own code-split chunk
// (`autoCodeSplitting`, vite.config.ts), so TanStack Query and `aws-amplify/api`
// stay out of the eager auth-shell bundle (NFR-PERF-4, System Design §2.6) —
// `_auth/**` never imports this module.
export const Route = createFileRoute('/_app')({
    beforeLoad: async ({ location }) => {
        const { tokens } = await fetchAuthSession();
        if (!tokens) {
            throw redirect({ to: '/get-started', search: { redirect: location.href } });
        }
    },
    component: () => (
        <QueryClientProvider client={queryClient}>
            <Outlet />
        </QueryClientProvider>
    ),
});
