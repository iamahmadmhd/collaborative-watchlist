import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TextField } from '../../../shared/ui/text-field';
import { Button } from '../../../shared/ui/button';
import { useUpdateDisplayName } from '../api/edit-profile';

const schema = z.object({
    displayName: z.string().trim().min(1, 'Enter a display name'),
});

type FormValues = z.infer<typeof schema>;

// docs/design/Settings.dc.html, PUBLIC IDENTITY section. Unlike the username field
// beside it (claim-once, ADR-011/System Design §9 Known Limitation #6 — no rename
// support this release), a display name has no uniqueness constraint and FR-AUTH-5
// explicitly frames it as ongoing ("allow members to set a display name"), so this
// is a plain editable field with its own save action.
export function EditProfileForm({ currentDisplayName }: { currentDisplayName: string | null }) {
    const updateDisplayName = useUpdateDisplayName();
    const {
        register,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<FormValues>({ resolver: zodResolver(schema), values: { displayName: currentDisplayName ?? '' } });

    const onSubmit = handleSubmit(async ({ displayName }) => {
        try {
            await updateDisplayName.mutateAsync(displayName);
            reset({ displayName });
        } catch {
            // Previously silent: a rejected update left the form dirty with no
            // feedback at all, which is why this looked like the save "just didn't
            // stick" rather than a failure. See edit-profile/api/edit-profile.ts.
            setError('root', { message: 'Could not save your display name. Please try again.' });
        }
    });

    return (
        <form onSubmit={onSubmit} noValidate className='flex flex-col gap-1.5'>
            <div className='flex items-end gap-2.5'>
                <TextField
                    label='Display name'
                    autoComplete='name'
                    className='flex-1'
                    errorMessage={errors.displayName?.message}
                    {...register('displayName')}
                />
                <Button
                    type='submit'
                    variant='secondary'
                    isLoading={isSubmitting}
                    disabled={!isDirty}
                    className='h-11'
                >
                    Save
                </Button>
            </div>
            {errors.root?.message && (
                <p role='alert' className='font-body text-danger text-sm'>
                    {errors.root.message}
                </p>
            )}
        </form>
    );
}
