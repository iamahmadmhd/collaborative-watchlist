import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { VerifyPage } from '../../../pages/auth/verify';

// `.catch()` rather than required: a missing/invalid email or mode shouldn't
// produce TanStack Router's default not-found/error boundary for "you navigated
// here directly" — VerifyPage renders its own recovery state when email is empty.
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
