import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { autoSignIn, confirmSignIn, confirmSignUp, resendSignUpCode, signIn } from 'aws-amplify/auth';
import { OtpField } from '../../shared/ui/otp-field';
import { Button } from '../../shared/ui/button';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from './auth-error-message';

// FR-AUTH-1/2, ADR-010 (v1.2). One screen, two entry points, both landing on
// "enter the 6-digit code" — sign-up confirmation and sign-in confirmation are
// different Cognito operations (confirmSignUp vs confirmSignIn) but the same UX,
// so `mode` picks the call rather than duplicating this screen.
//
// signup: confirmSignUp() marks the account confirmed (does NOT establish a
// session on its own) — autoSignIn() was requested at signUp() time (sign-up.tsx)
// specifically so this can complete in one code, matching the design board rather
// than requiring a second sign-in immediately after.
// signin: confirmSignIn() completes the EMAIL_OTP challenge signIn() started.
const schema = z.object({
    code: z.string().length(6, 'Enter the 6-digit code'),
});

type FormValues = z.infer<typeof schema>;

// redirect?: string | undefined — see the matching note in sign-up.tsx.
export function VerifyPage({
    email,
    mode,
    redirect,
}: {
    email: string;
    mode: 'signup' | 'signin';
    redirect?: string | undefined;
}) {
    const navigate = useNavigate();
    const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
    const {
        control,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

    if (!email) {
        return (
            <AuthPageShell title='Enter the code'>
                <p className='font-body text-muted text-sm'>
                    We couldn&apos;t tell which account this code is for.{' '}
                    <Link to='/sign-up' className='text-accent font-medium underline-offset-2 hover:underline'>
                        Start over
                    </Link>
                    .
                </p>
            </AuthPageShell>
        );
    }

    const onSubmit = handleSubmit(async ({ code }) => {
        try {
            if (mode === 'signup') {
                const { nextStep } = await confirmSignUp({ username: email, confirmationCode: code });
                if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
                    await autoSignIn();
                }
            } else {
                await confirmSignIn({ challengeResponse: code });
            }
            await navigate({ to: redirect ?? '/' });
        } catch (err) {
            setError('root', { message: authErrorMessage(err) });
        }
    });

    const onResend = async () => {
        setResendState('sending');
        try {
            if (mode === 'signup') {
                await resendSignUpCode({ username: email });
            } else {
                // EMAIL_OTP has no dedicated "resend" API — re-initiating the same
                // sign-in challenge is what issues a fresh code.
                await signIn({
                    username: email,
                    options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
                });
            }
            setResendState('sent');
        } catch (err) {
            setError('root', { message: authErrorMessage(err) });
            setResendState('idle');
        }
    };

    return (
        <AuthPageShell
            title='Enter the code'
            subtitle={
                <>
                    Sent to <span className='text-text font-medium'>{email}</span>. It expires in 10 minutes.
                </>
            }
        >
            <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                <OtpField control={control} name='code' label='Verification code' length={6} />
                {errors.root?.message && (
                    <div className='border-danger bg-danger/10 flex items-center gap-2.5 rounded-[3px] border px-3.5 py-2.5'>
                        <div className='bg-danger h-7.5 w-1' />
                        <p role='alert' className='font-body text-danger text-sm font-semibold'>
                            {errors.root.message}
                        </p>
                    </div>
                )}
                <Button type='submit' isLoading={isSubmitting}>
                    Verify and continue
                </Button>
            </form>
            <div className='font-body text-muted text-sm'>
                {resendState === 'sent' ? (
                    <p>New code sent — check your inbox.</p>
                ) : (
                    <button
                        type='button'
                        onClick={onResend}
                        disabled={resendState === 'sending'}
                        className='text-accent font-medium underline-offset-2 hover:underline disabled:opacity-60'
                    >
                        Resend code
                    </button>
                )}
            </div>
        </AuthPageShell>
    );
}
