import { useEffect, useState } from 'react';
import { getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../../shared/lib/amplify-client';

// Shared by the post-verification username screen and Settings' recovery path, which
// both claim through the same mutation.
//
// The pattern check is a deliberate duplicate of the handler's: amplify/** and src/**
// are separate compilation contexts. This copy is UX only — the enforcement is the
// conditional write on submit.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

// Presentational only: a collision that slips past still surfaces as ALREADY_TAKEN on
// submit, which is the atomic enforcement. Stale results are ignored by comparing the
// resolved value against the current candidate rather than clearing on every keystroke.
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

export type ClaimUsernameError =
    'INVALID_FORMAT' | 'ALREADY_CLAIMED' | 'ALREADY_TAKEN' | 'DISPLAY_NAME_FAILED' | 'UNKNOWN';
export type ClaimUsernameOutcome = { success: true } | { success: false; error: ClaimUsernameError };

// A display name set on the same screen is written straight after a successful claim.
//
// A plain async function rather than a TanStack Query mutation: this runs under the
// router's `_auth/**` group, which QueryClientProvider deliberately does not wrap, so
// a useMutation here would throw "No QueryClient set". The form tracks submission
// through react-hook-form's own isSubmitting anyway.
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
    // ALREADY_CLAIMED means the claim landed — on a retry after the display-name write
    // below failed, or in another tab. Reporting it as a failure would leave a member
    // who already has a username with no way past this form.
    if (!data.success && data.error !== 'ALREADY_CLAIMED') {
        return { success: false, error: data.error ?? 'UNKNOWN' };
    }
    // Past this point the username is durably claimed, so a failure here is reported as
    // its own outcome rather than as a failed claim. Resubmitting retries just this write.
    if (displayName) {
        try {
            const { userId } = await getCurrentUser();
            const { data: profile, errors: updateErrors } = await client.models.UserProfile.update({
                id: userId,
                displayName,
            });
            if (updateErrors?.length || !profile) {
                return { success: false, error: 'DISPLAY_NAME_FAILED' };
            }
        } catch {
            return { success: false, error: 'DISPLAY_NAME_FAILED' };
        }
    }
    return { success: true };
}
