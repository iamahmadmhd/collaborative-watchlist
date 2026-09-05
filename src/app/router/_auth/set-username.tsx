import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { fetchAuthSession } from 'aws-amplify/auth';
import { UsernamePage } from '../../../pages/auth/set-username';

// The one route in the _auth group that requires a session rather than
// forbidding one (System Design §2.5, ADR-011) — reached only after email
// verification, with autoSignIn() already having run (verify.tsx). The
// project-wide route guard is still deferred (CLAUDE.md; _auth/route.tsx's own
// comment), so this route carries its own local check instead of waiting on it.
const searchSchema = z.object({
    redirect: z.string().optional(),
});

export const Route = createFileRoute('/_auth/set-username')({
    validateSearch: searchSchema,
    beforeLoad: async () => {
        const { tokens } = await fetchAuthSession();
        if (!tokens) {
            throw redirect({ to: '/get-started' });
        }
    },
    component: RouteComponent,
});

function RouteComponent() {
    const { redirect } = Route.useSearch();
    return <UsernamePage redirect={redirect} />;
}
