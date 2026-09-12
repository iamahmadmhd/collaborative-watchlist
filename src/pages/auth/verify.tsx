import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { autoSignIn, confirmSignIn, confirmSignUp, resendSignUpCode, signIn } from 'aws-amplify/auth';
import { OtpField } from '../../shared/ui/otp-field';
import { Button } from '../../shared/ui/button';
import { AuthPageShell } from './auth-page-shell';
import { authErrorMessage } from '../../shared/lib/auth-error-message';
import { safeRedirect } from '../../shared/lib/safe-redirect';

// One screen, two entry points: sign-up and sign-in confirmation are different Cognito
// calls with the same UX, so `mode` picks between them. They do not share a code
// length — confirmSignUp's classic verification code is 6 digits, confirmSignIn's
// EMAIL_OTP challenge sends 8 — so `mode` drives CODE_LENGTH as well.
//
// confirmSignUp() only marks the account confirmed; the session comes from the
// autoSignIn() requested back at signUp(), which is what lets this finish in one code.
// The username step follows, once that session exists. A returning member completing
// confirmSignIn() goes straight in.
const CODE_LENGTH: Record<'signup' | 'signin', number> = {
    signup: 6,
    signin: 8,
};

function createSchema(mode: 'signup' | 'signin') {
    const length = CODE_LENGTH[mode];
    return z.object({
        code: z.string().length(length, `Enter the ${length}-digit code`),
    });
}

type FormValues = { code: string };

const RESEND_COOLDOWN_SECONDS = 30;
// Drives the "N tries left" hint only; the real throttling and lockout are Cognito's,
// server-side. Resets on remount, i.e. on a fresh code request.
const MAX_CODE_ATTEMPTS = 5;

function formatCooldown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

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
    const codeLength = CODE_LENGTH[mode];
    const [isResending, setIsResending] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
    const [failedAttempts, setFailedAttempts] = useState(0);
    const {
        control,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(createSchema(mode)), defaultValues: { code: '' } });

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const id = setInterval(() => setResendCooldown((s) => s - 1), 1000);
        return () => clearInterval(id);
    }, [resendCooldown]);

    if (!email) {
        return (
            <AuthPageShell title='Enter the code'>
                <p className='font-body text-muted text-sm'>
                    We couldn&apos;t tell which account this code is for.{' '}
                    <Link to='/get-started' className='text-accent font-medium underline-offset-2 hover:underline'>
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
                await navigate({ to: '/set-username', search: { redirect } });
                return;
            }
            await confirmSignIn({ challengeResponse: code });
            await navigate({ to: safeRedirect(redirect) });
        } catch (err) {
            setFailedAttempts((n) => n + 1);
            setError('root', { message: authErrorMessage(err) });
        }
    });

    const onResend = async () => {
        setIsResending(true);
        try {
            if (mode === 'signup') {
                await resendSignUpCode({ username: email });
            } else {
                // EMAIL_OTP has no resend API: re-initiating the challenge issues a
                // fresh code.
                await signIn({
                    username: email,
                    options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
                });
            }
            setResendCooldown(RESEND_COOLDOWN_SECONDS);
            setFailedAttempts(0);
        } catch (err) {
            setError('root', { message: authErrorMessage(err) });
        } finally {
            setIsResending(false);
        }
    };

    const triesLeft = MAX_CODE_ATTEMPTS - failedAttempts;

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
                <OtpField control={control} name='code' label='Verification code' length={codeLength} />
                {errors.root?.message && (
                    <div className='border-danger bg-danger/10 flex items-center gap-2.5 rounded-[3px] border px-3.5 py-2.5'>
                        <div className='bg-danger h-7.5 w-1' />
                        <div className='flex flex-col gap-0.5'>
                            <p role='alert' className='font-body text-danger text-sm font-semibold'>
                                {errors.root.message}
                            </p>
                            {triesLeft > 0 && (
                                <p className='font-body text-muted text-xs'>
                                    {triesLeft} {triesLeft === 1 ? 'try' : 'tries'} left before you&rsquo;ll need a new
                                    code.
                                </p>
                            )}
                        </div>
                    </div>
                )}
                <Button type='submit' isLoading={isSubmitting}>
                    Verify and continue
                </Button>
            </form>
            <div className='font-body flex items-center justify-between text-sm'>
                <span className='text-muted'>
                    Didn&rsquo;t get it?{' '}
                    <button
                        type='button'
                        onClick={onResend}
                        disabled={resendCooldown > 0 || isResending}
                        className='text-accent disabled:text-muted font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline'
                    >
                        Resend
                    </button>
                </span>
                {resendCooldown > 0 && (
                    <span className='text-muted font-mono text-[11px]'>RESEND IN {formatCooldown(resendCooldown)}</span>
                )}
            </div>
            <div className='border-border bg-raised flex items-center gap-2.5 rounded-[3px] border p-3 lg:hidden'>
                <div className='bg-m3 h-7.5 w-1' />
                <p className='font-body text-muted text-xs leading-relaxed'>
                    Each code works once. Ask for a new one and the old one stops working.
                </p>
            </div>
        </AuthPageShell>
    );
}
