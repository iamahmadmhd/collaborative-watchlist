import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { fetchAuthSession } from 'aws-amplify/auth';
import { UsernamePage } from '../../../pages/auth/set-username';

// The one route in the _auth group that requires a session rather than forbidding
// one: it is reached only after verification, with autoSignIn() already run. It
// carries its own check because the shared guard covers `_app/**`, not this group.
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
