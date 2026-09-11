import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { signIn, signUp } from 'aws-amplify/auth';
import { TextField } from '../../shared/ui/text-field';
import { Button } from '../../shared/ui/button';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from '../../shared/lib/auth-error-message';

// One screen for both entry points: with no password, signing in is just proving you
// own the email again, so the only difference is whether Cognito already has an account
// — which the API response reveals, not the visitor picking a page.
//
// signUp() is attempted first, falling back to signIn() on UsernameExistsException.
// The reverse order cannot work: the app client has PreventUserExistenceErrors enabled,
// so signIn() with EMAIL_OTP returns a decoy challenge for a nonexistent user rather
// than throwing, and signIn-first would never reach signUp(). SignUp is exempt from
// that protection, so its duplicate error stays reliable. See System Design ADR-012.
//
// autoSignIn must be the options object, not `true`: a bare `true` builds the
// post-confirmation autoSignIn() call with no authFlowType, which falls through to
// SRP sign-in and fails with "Password is required to signIn" on a passwordless pool.
const schema = z.object({
    email: z.email('Enter a valid email address'),
});

type FormValues = z.infer<typeof schema>;

// `redirect?: string | undefined`, not `redirect?: string`: the route forwards
// useSearch()'s value directly, and exactOptionalPropertyTypes rejects an explicit
// undefined against a plain optional property.
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
        <AuthPageShell title='Get started' subtitle="We'll send you a verification code.">
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
