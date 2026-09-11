import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TextField } from '../../../shared/ui/text-field';
import { Button } from '../../../shared/ui/button';
import { DialogClose, DialogPopup, DialogRoot, DialogTrigger } from '../../../shared/ui/dialog';
import { useCreateWatchlist } from '../api/create-watchlist';

// A minimal two-field form: name required, description optional.
const schema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string().trim(),
});

type FormValues = z.infer<typeof schema>;

export function CreateWatchlistDialog() {
    const [open, setOpen] = useState(false);
    const createWatchlist = useCreateWatchlist();
    const {
        register,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', description: '' } });

    const onSubmit = handleSubmit(async ({ name, description }) => {
        try {
            await createWatchlist.mutateAsync({ name, description });
            reset();
            setOpen(false);
        } catch (err) {
            setError('root', { message: err instanceof Error ? err.message : 'Could not create watchlist.' });
        }
    });

    return (
        <DialogRoot
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    reset();
                }
            }}
        >
            <DialogTrigger render={<Button>New watchlist</Button>} />
            <DialogPopup
                title='New watchlist'
                description="Give it a name — you can add collaborators once it's created."
            >
                <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                    <TextField label='Name' errorMessage={errors.name?.message} {...register('name')} />
                    <TextField label='Description' description='Optional' {...register('description')} />
                    {errors.root?.message && (
                        <p role='alert' className='font-body text-danger text-sm'>
                            {errors.root.message}
                        </p>
                    )}
                    <div className='mt-1 flex justify-end gap-3'>
                        <DialogClose
                            render={
                                <Button variant='secondary' type='button'>
                                    Cancel
                                </Button>
                            }
                        />
                        <Button type='submit' isLoading={isSubmitting}>
                            Create
                        </Button>
                    </div>
                </form>
            </DialogPopup>
        </DialogRoot>
    );
}
