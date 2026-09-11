import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SignUpPage } from '../../../pages/auth/get-started';

// The sole auth entry point — there is no separate sign-in route. `redirect` carries
// the path the route guard bounced the visitor from, so they return there on success.
const searchSchema = z.object({
    redirect: z.string().optional(),
});

export const Route = createFileRoute('/_auth/get-started')({
    validateSearch: searchSchema,
    component: RouteComponent,
});

function RouteComponent() {
    const { redirect } = Route.useSearch();
    return <SignUpPage redirect={redirect} />;
}
