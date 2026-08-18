import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SignUpPage } from '../../../pages/auth/sign-up';

// The sole auth entry point (System Design §2.5, ADR-010 — no separate /sign-in
// route). `redirect`: the path a not-yet-built route guard will one day attach so
// a bounced visitor lands back where they meant to go (FR-DISC-6) — validated
// here, per this project's URL-state-is-Zod-validated rule, even though nothing
// writes it yet.
const searchSchema = z.object({
    redirect: z.string().optional(),
});

export const Route = createFileRoute('/_auth/sign-up')({
    validateSearch: searchSchema,
    component: RouteComponent,
});

function RouteComponent() {
    const { redirect } = Route.useSearch();
    return <SignUpPage redirect={redirect} />;
}
