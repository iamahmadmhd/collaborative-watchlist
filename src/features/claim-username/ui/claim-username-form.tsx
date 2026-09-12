import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TextField } from '../../../shared/ui/text-field';
import { Button } from '../../../shared/ui/button';
import { claimUsername, useUsernameAvailability, USERNAME_PATTERN } from '../api/claim-username';

const schema = z.object({
    username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(USERNAME_PATTERN, '3–20 characters: lowercase letters, numbers and underscores'),
    displayName: z.string().trim().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

// Shared by the post-verification username screen and Settings' recovery path. Each
// caller supplies its own surrounding chrome and decides what "done" means via
// onSuccess.
export function ClaimUsernameForm({ submitLabel, onSuccess }: { submitLabel: string; onSuccess: () => void }) {
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
    const checked = useUsernameAvailability(candidate, validFormat);

    const onSubmit = handleSubmit(async ({ username, displayName }) => {
        try {
            const result = await claimUsername({ username, displayName: displayName || undefined });
            if (!result.success) {
                if (result.error === 'ALREADY_TAKEN') {
                    setError('username', { message: 'That username is already taken.' });
                } else if (result.error === 'DISPLAY_NAME_FAILED') {
                    setError('root', {
                        message:
                            'Your username is saved, but we could not save your display name. Try again, or set it later in Settings.',
                    });
                } else {
                    setError('root', { message: 'Could not claim that username. Please try again.' });
                }
                return;
            }
            onSuccess();
        } catch {
            setError('root', { message: 'Something went wrong. Please try again.' });
        }
    });

    return (
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
                {submitLabel}
            </Button>
        </form>
    );
}
