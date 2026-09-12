import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { VerifyPage } from '../../../pages/auth/verify';

// `.catch()` rather than required: VerifyPage renders its own recovery state for a
// direct navigation, instead of the router's default error boundary.
const searchSchema = z.object({
    email: z.string().catch(''),
    mode: z.enum(['signup', 'signin']).catch('signin'),
    redirect: z.string().optional(),
});

export const Route = createFileRoute('/_auth/verify')({
    validateSearch: searchSchema,
    component: RouteComponent,
});

function RouteComponent() {
    const { email, mode, redirect } = Route.useSearch();
    return <VerifyPage email={email} mode={mode} redirect={redirect} />;
}
