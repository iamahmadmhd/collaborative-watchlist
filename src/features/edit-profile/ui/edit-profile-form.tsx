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

// Unlike the claim-once username field beside it, a display name is freely editable,
// so this is a plain field with its own save action.
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
            // Without this a rejected update leaves the form dirty with no feedback,
            // which reads as a save that silently didn't stick.
            setError('root', { message: 'Could not save your display name. Please try again.' });
        }
    });

    return (
        <form onSubmit={onSubmit} noValidate className='flex flex-col gap-1.5'>
            <div className='flex items-end justify-between gap-2.5'>
                <TextField
                    label='Display Name'
                    autoComplete='name'
                    rootClassName='flex-1'
                    labelClassName='text-text text-[15px] font-semibold font-body capitalize tracking-tight'
                    errorMessage={errors.displayName?.message}
                    {...register('displayName')}
                />
                <Button type='submit' variant='secondary' isLoading={isSubmitting} disabled={!isDirty}>
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
