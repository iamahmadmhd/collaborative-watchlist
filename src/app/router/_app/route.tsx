import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { fetchAuthSession } from 'aws-amplify/auth';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../shared/lib/query-client';

// Every route outside the auth group sits under this one pathless parent, so the
// guard runs once rather than per-route. beforeLoad's async nature is itself the
// "session not yet resolved" state: the router holds the pending state while this
// promise is in flight and redirects only once it resolves to "no tokens", so a
// signed-in member is never bounced on a hard refresh. Presentational only — AppSync
// enforces authorization regardless.
//
// QueryClientProvider is composed here rather than in __root.tsx so TanStack Query
// and aws-amplify/api stay out of the eager auth-shell chunk; `_auth/**` never
// imports this module.
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
