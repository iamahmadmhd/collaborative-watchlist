import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { signIn, signUp } from 'aws-amplify/auth';
import { TextField } from '../../shared/ui/text-field';
import { Button } from '../../shared/ui/button';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from './auth-error-message';

// FR-AUTH-1, ADR-012 (v1.5). One screen for both entry points — the design
// board's own overview lists only "/signup and /verify" for the whole auth flow,
// no separate sign-in route. A passwordless flow makes this natural: signing in
// is just "prove you own this email again," the same email field either way —
// the only thing that differs is whether Cognito already has an account for it,
// which the app discovers from the API response, not from the visitor picking
// the right page up front.
//
// Mechanism: attempt signUp() first, not signIn() first. If it throws
// UsernameExistsException, fall back to signIn() for the returning-member path.
// This is the reverse of ADR-010's original choice, corrected in ADR-012:
// Amplify Gen2's app client has PreventUserExistenceErrors enabled by default
// (confirmed against the deployed pool), so signIn() with EMAIL_OTP returns an
// indistinguishable decoy challenge for a nonexistent user instead of throwing
// UserNotFoundException — no email is ever sent and signIn-first can never reach
// signUp(). SignUp is not covered by that setting (it must reveal a duplicate to
// prevent overwriting an account), so UsernameExistsException stays reliable.
// Either way the next stop is /verify; a new member picks a username afterward,
// on its own screen (ADR-011) — no username field lives on this screen.
//
// autoSignIn MUST be the options object below, not `true`. Traced through
// @aws-amplify/auth's source: a bare `true` makes signUp() build the post-confirm
// autoSignIn() call with no authFlowType at all, which falls through to Cognito's
// SRP (password) sign-in — "Password is required to signIn" on a pool that has no
// password. Passing the same { authFlowType: 'USER_AUTH', preferredChallenge:
// 'EMAIL_OTP' } shape used everywhere else in this file routes autoSignIn()
// through the same EMAIL_OTP path instead.
const schema = z.object({
    email: z.email('Enter a valid email address'),
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

    const onSubmit = handleSubmit(async ({ email }) => {
        try {
            await signUp({
                username: email,
                options: {
                    userAttributes: { email },
                    autoSignIn: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
                },
            });
            await navigate({ to: '/verify', search: { email, mode: 'signup', redirect } });
        } catch (err) {
            if (err instanceof Error && err.name === 'UsernameExistsException') {
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
                } catch (signInErr) {
                    setError('root', { message: authErrorMessage(signInErr) });
                }
                return;
            }
            setError('root', { message: authErrorMessage(err) });
        }
    });

    return (
        <AuthPageShell title='Get started' subtitle="We'll send you a six-digit code.">
            <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                <TextField
                    label='Email'
                    type='email'
                    autoComplete='email'
                    errorMessage={errors.email?.message}
                    {...register('email')}
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
        </AuthPageShell>
    );
}
