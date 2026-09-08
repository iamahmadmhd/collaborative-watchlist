import { useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';

// FR-AUTH-3/4/5, ADR-011. Shared by the post-verification username screen
// (src/pages/auth/set-username.tsx — the primary path, run once right after
// email verification) and, per ADR-011's consequences, Settings — the narrower
// recovery path for a member who verified but never finished that screen. Both
// callers claim through the same claimUsername mutation, so the logic lives
// here once rather than being duplicated per caller.
//
// Not shared with the backend: amplify/** and src/** are separate compilation
// contexts, so this is a deliberate, separately-maintained duplicate of the
// pattern check in claim-username/handler.ts (System Design §2.5 — "UX only";
// the actual enforcement is claimUsername's conditional write on submit).
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Debounced live-availability indicator (System Design §2.5). Presentational
// only — a collision that slips past this still surfaces as ALREADY_TAKEN from
// claimUsername on submit, which is the real, atomic enforcement. Stale results
// are ignored by comparing the resolved value against the candidate current at
// render time, rather than clearing state on every keystroke.
export function useUsernameAvailability(candidate: string | undefined, validFormat: boolean) {
    const [availability, setAvailability] = useState<{ value: string; available: boolean } | null>(null);

    useEffect(() => {
        if (!validFormat || !candidate) return;
        const timer = setTimeout(() => {
            client.models.Username.get({ username: candidate }).then(
                ({ data }) => setAvailability({ value: candidate, available: !data }),
                () => setAvailability(null),
            );
        }, 400);
        return () => clearTimeout(timer);
    }, [candidate, validFormat]);

    return validFormat && availability?.value === candidate ? availability : null;
}

export type ClaimUsernameError = 'INVALID_FORMAT' | 'ALREADY_CLAIMED' | 'ALREADY_TAKEN' | 'UNKNOWN';
export type ClaimUsernameOutcome = { success: true } | { success: false; error: ClaimUsernameError };

// FR-AUTH-5 rides along optionally: a display name set on the same screen is
// written straight after a successful claim, not as a separate step.
//
// A plain async function, not a TanStack Query mutation: this is called from
// the post-verification username screen, which lives under the router's
// `_auth/**` group — the one subtree QueryClientProvider deliberately does
// NOT wrap (`_app/route.tsx`'s own comment: "`_auth/**` never imports this
// module", to keep TanStack Query out of the eager auth-shell bundle,
// NFR-PERF-4). A `useMutation` here would throw "No QueryClient set" the
// moment this screen rendered. ClaimUsernameForm doesn't need a mutation
// object's own pending/error state anyway — it already tracks submission via
// react-hook-form's own `isSubmitting`.
export async function claimUsername({
    username,
    displayName,
}: {
    username: string;
    displayName?: string | undefined;
}): Promise<ClaimUsernameOutcome> {
    const { data, errors } = await client.mutations.claimUsername({ username });
    if (errors?.length || !data) {
        return { success: false, error: 'UNKNOWN' };
    }
    if (!data.success) {
        return { success: false, error: data.error ?? 'UNKNOWN' };
    }
    if (displayName) {
        const { userId } = await getCurrentUser();
        await client.models.UserProfile.update({ id: userId, displayName });
    }
    return { success: true };
}
