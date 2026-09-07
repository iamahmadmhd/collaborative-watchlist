import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { getCurrentUser } from 'aws-amplify/auth';
import { TextField } from '../../shared/ui/text-field';
import { Button } from '../../shared/ui/button';
import { client } from '../../shared/lib/amplify-client';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from './auth-error-message';

// FR-AUTH-3/4/5, ADR-011 (v1.4). Reached only once email verification succeeds
// for a new member (verify.tsx navigates here on mode 'signup') — the session
// already exists by this point (autoSignIn ran in verify.tsx), which is what
// makes the live availability check below safe to build server-side: it's an
// authenticated read against the Username sentinel model
// (allow.authenticated().to(['read']), amplify/data/resource.ts), not the
// anonymous query ADR-009/V-10 forbid pre-verification.
//
// Not shared with the backend: amplify/** and src/** are separate compilation
// contexts, so this is a deliberate, separately-maintained duplicate of the
// pattern check in claim-username/handler.ts (System Design §2.5 — "UX only";
// the actual enforcement is claimUsername's conditional write, called on submit).
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

const schema = z.object({
    username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(USERNAME_PATTERN, '3–20 characters: lowercase letters, numbers and underscores'),
    displayName: z.string().trim().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

// redirect?: string | undefined — see the matching note in sign-up.tsx.
export function UsernamePage({ redirect }: { redirect?: string | undefined }) {
    const navigate = useNavigate();
    const {
        register,
        handleSubmit,
        control,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema) });

    const usernameInput = useWatch({ control, name: 'username' });
    const candidate = usernameInput?.trim().toLowerCase();
    const validFormat = !!candidate && USERNAME_PATTERN.test(candidate);
    const [availability, setAvailability] = useState<{ value: string; available: boolean } | null>(null);

    // Debounced live-availability indicator (System Design §2.5). Presentational
    // only — a collision that slips past this still surfaces as ALREADY_TAKEN
    // from claimUsername on submit, which is the real, atomic enforcement. Stale
    // results are ignored by comparing `availability.value` against the current
    // input at render time (`checked`, below) rather than clearing state here.
    useEffect(() => {
        if (!validFormat) return;
        const timer = setTimeout(() => {
            client.models.Username.get({ username: candidate }).then(
                ({ data }) => setAvailability({ value: candidate, available: !data }),
                () => setAvailability(null),
            );
        }, 400);
        return () => clearTimeout(timer);
    }, [candidate, validFormat]);

    const onSubmit = handleSubmit(async ({ username, displayName }) => {
        try {
            const { data, errors: mutationErrors } = await client.mutations.claimUsername({ username });
            if (mutationErrors?.length) {
                setError('root', { message: 'Could not claim that username. Please try again.' });
                return;
            }
            if (!data?.success) {
                if (data?.error === 'ALREADY_TAKEN') {
                    setError('username', { message: 'That username is already taken.' });
                } else {
                    setError('root', { message: 'Could not claim that username. Please try again.' });
                }
                return;
            }
            if (displayName) {
                const { userId } = await getCurrentUser();
                await client.models.UserProfile.update({ id: userId, displayName });
            }
            await navigate({ to: redirect ?? '/' });
        } catch (err) {
            setError('root', { message: authErrorMessage(err) });
        }
    });

    const checked = validFormat && availability?.value === candidate ? availability : null;

    return (
        <AuthPageShell
            title='Pick a username'
            subtitle='Friends add you to lists by username, and it labels every film you add.'
        >
            <div className='text-muted flex items-center gap-2 font-mono text-[10px] tracking-[0.08em]'>
                <span className='text-ok'>EMAIL VERIFIED</span>
                <span className='bg-border h-px flex-1' />
                <span className='text-text'>LAST STEP</span>
            </div>
            <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                <div className='flex flex-col gap-1.5'>
                    <TextField
                        label='Username'
                        autoComplete='off'
                        errorMessage={errors.username?.message}
                        {...register('username')}
                    />
                    {!errors.username?.message && (
                        <span
                            className={
                                checked
                                    ? checked.available
                                        ? 'text-ok font-mono text-[10px] tracking-widest'
                                        : 'text-danger font-mono text-[10px] tracking-widest'
                                    : 'text-muted font-body text-xs'
                            }
                        >
                            {checked
                                ? checked.available
                                    ? 'AVAILABLE'
                                    : 'ALREADY TAKEN'
                                : '3–20 characters: lowercase letters, numbers and underscores.'}
                        </span>
                    )}
                </div>
                <TextField label='Display name' autoComplete='name' {...register('displayName')} />
                {errors.root?.message && (
                    <p role='alert' className='font-body text-danger text-sm'>
                        {errors.root.message}
                    </p>
                )}
                <Button type='submit' isLoading={isSubmitting}>
                    Finish setting up
                </Button>
            </form>
            <p className='font-body text-muted text-xs leading-relaxed'>
                Your username and display name are visible to anyone you share a list with.
            </p>
        </AuthPageShell>
    );
}
