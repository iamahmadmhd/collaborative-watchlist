import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { signIn, signUp } from 'aws-amplify/auth';
import { TextField } from '../../shared/ui/text-field';
import { Button } from '../../shared/ui/button';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from './auth-error-message';

// FR-AUTH-1/3/6, ADR-010 (v1.2). One screen for both entry points — the design
// board's own overview lists only "/signup and /verify" for the whole auth flow,
// no separate sign-in route (its "Sign in" link has no distinct `step` in the
// component's own prop schema). A passwordless flow makes this natural: signing
// in is just "prove you own this email again," which is the same email field
// either way — the only thing that differs is whether Cognito already has an
// account for it, which the app discovers from the API response, not from the
// visitor picking the right page up front.
//
// Mechanism: always attempt signIn() first — a lightweight "does this account
// exist" check via the EMAIL_OTP challenge. If it throws UserNotFoundException,
// this is a new member: require a handle at that point (not before — a returning
// member shouldn't be blocked by a field they have no reason to fill in) and call
// signUp() instead. No password is ever collected, stored, or offered as a
// sign-in method.
//
// signIn-first, not signUp-first: trying signUp() first would let a new member
// submit with an empty handle and succeed — Cognito doesn't require the custom
// attribute — silently producing an account with no handle when the field was
// simply never validated as required, instead of a form error asking for one.
//
// No live availability check: an unauthenticated "is this handle taken" query
// would reopen exactly the anonymous GraphQL surface ADR-009/V-10 close off. The
// format check below is UX only (System Design §2.5's existing principle,
// carried over) — the real atomicity is server-side, in post-confirmation. A
// collision surfaces after the fact, recoverable via claim-handle from Settings.
const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

const schema = z.object({
    email: z.email('Enter a valid email address'),
    handle: z
        .string()
        .trim()
        .toLowerCase()
        .regex(HANDLE_PATTERN, '3–20 characters: lowercase letters, numbers, underscore')
        .optional()
        .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

// `redirect?: string | undefined`, not just `redirect?: string`: the route
// component forwards Route.useSearch()'s value (typed `string | undefined` for
// an optional Zod field) directly as this prop, and exactOptionalPropertyTypes
// rejects an explicit `undefined` against a plain `?: string`.
export function SignUpPage({ redirect }: { redirect?: string | undefined }) {
    const navigate = useNavigate();
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema) });

    const onSubmit = handleSubmit(async ({ email, handle }) => {
        try {
            const { nextStep } = await signIn({
                username: email,
                options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
            });
            if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE') {
                await navigate({ to: '/verify', search: { email, mode: 'signin', redirect } });
                return;
            }
            setError('root', { message: 'Sign-in could not continue. Please try again.' });
        } catch (err) {
            if (err instanceof Error && err.name === 'UserNotFoundException') {
                if (!handle) {
                    setError('handle', { message: "You're new here — choose a handle to create your account." });
                    return;
                }
                try {
                    await signUp({
                        username: email,
                        options: { userAttributes: { email, 'custom:handle': handle }, autoSignIn: true },
                    });
                    await navigate({ to: '/verify', search: { email, mode: 'signup', redirect } });
                } catch (signUpErr) {
                    setError('root', { message: authErrorMessage(signUpErr) });
                }
                return;
            }
            setError('root', { message: authErrorMessage(err) });
        }
    });

    return (
        <AuthPageShell title='Continue' subtitle="We'll email a six-digit code — no password needed.">
            <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                <TextField
                    label='Email'
                    type='email'
                    autoComplete='email'
                    errorMessage={errors.email?.message}
                    {...register('email')}
                />
                <TextField
                    label='Handle'
                    autoComplete='off'
                    description='New here? Pick one — collaborators find you by this. Already have an account? Leave it blank.'
                    errorMessage={errors.handle?.message}
                    {...register('handle')}
                />
                {errors.root?.message && (
                    <p role='alert' className='font-body text-danger text-sm'>
                        {errors.root.message}
                    </p>
                )}
                <Button type='submit' isLoading={isSubmitting}>
                    Send me a code
                </Button>
            </form>
            <p className='font-body text-muted text-xs leading-relaxed'>
                By continuing you agree that your handle and display name are public to anyone you share a list with.
            </p>
        </AuthPageShell>
    );
}
