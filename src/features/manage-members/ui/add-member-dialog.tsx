import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TextField } from '../../../shared/ui/text-field';
import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import { DialogClose, DialogPopup, DialogRoot, DialogTrigger } from '../../../shared/ui/dialog';
import { useAddMember } from '../api/manage-members';

// FR-MEM-1/2/3/10: Owner adds a collaborator by @username, choosing Editor or
// Viewer. select.tsx's own header comment names this dialog as its second caller
// (after the genre filter). USERNAME_NOT_FOUND / ALREADY_MEMBER map to a field
// error since they're about the username the Owner just typed; every other
// rejection (NOT_OWNER, MEMBER_CAP_REACHED, CONFLICT, INVALID_ROLE) is a root
// error — none of them point at a specific field.
const schema = z.object({
    username: z.string().trim().toLowerCase().min(1, 'Username is required'),
});

type FormValues = z.infer<typeof schema>;
type Role = 'EDITOR' | 'VIEWER';

const ROLE_ITEMS: { value: Role; label: string }[] = [
    { value: 'EDITOR', label: 'Editor' },
    { value: 'VIEWER', label: 'Viewer' },
];

export function AddMemberDialog({ watchlistId }: { watchlistId: string }) {
    const [open, setOpen] = useState(false);
    const [role, setRole] = useState<Role>('EDITOR');
    const addMember = useAddMember(watchlistId);
    const {
        register,
        handleSubmit,
        reset,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { username: '' } });

    function resetAll() {
        reset();
        setRole('EDITOR');
    }

    const onSubmit = handleSubmit(async ({ username }) => {
        try {
            const result = await addMember.mutateAsync({ username, role });
            if (!result.success) {
                switch (result.error) {
                    case 'USERNAME_NOT_FOUND':
                        setError('username', { message: 'No member found with that username.' });
                        return;
                    case 'ALREADY_MEMBER':
                        setError('username', { message: 'This member is already on this list.' });
                        return;
                    case 'MEMBER_CAP_REACHED':
                        setError('root', { message: 'This list already has the maximum of 20 members.' });
                        return;
                    default:
                        setError('root', { message: 'Could not add that collaborator. Please try again.' });
                        return;
                }
            }
            resetAll();
            setOpen(false);
        } catch (err) {
            setError('root', { message: err instanceof Error ? err.message : 'Could not add that collaborator.' });
        }
    });

    return (
        <DialogRoot
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    resetAll();
                }
            }}
        >
            <DialogTrigger render={<Button variant='secondary'>Add collaborator</Button>} />
            <DialogPopup title='Add collaborator' description='Add a member by username and choose their role.'>
                <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
                    <TextField
                        label='Username'
                        autoComplete='off'
                        errorMessage={errors.username?.message}
                        {...register('username')}
                    />
                    <div className='flex flex-col gap-1.5'>
                        <span className='text-muted font-mono text-[10px] tracking-[0.08em] uppercase'>Role</span>
                        <Select items={ROLE_ITEMS} value={role} onValueChange={setRole} aria-label='Role' />
                    </div>
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
                            Add
                        </Button>
                    </div>
                </form>
            </DialogPopup>
        </DialogRoot>
    );
}
