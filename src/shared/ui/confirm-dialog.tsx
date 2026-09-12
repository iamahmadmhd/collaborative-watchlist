import { useState, type ReactElement } from 'react';
import { Button } from './button';
import { DialogClose, DialogPopup, DialogRoot, DialogTrigger } from './dialog';

// The confirm-dialog convention for destructive actions: open state, an error slot that
// clears on close, and a Cancel/confirm pair where confirm shows its own pending state
// and keeps the dialog open on failure so the error stays visible.
export function ConfirmDialog({
    trigger,
    title,
    description,
    confirmLabel,
    onConfirm,
    fallbackErrorMessage = 'Something went wrong. Please try again.',
}: {
    trigger: ReactElement;
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
    fallbackErrorMessage?: string;
}) {
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, setIsPending] = useState(false);

    async function handleConfirm() {
        setError(null);
        setIsPending(true);
        try {
            await onConfirm();
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : fallbackErrorMessage);
        } finally {
            setIsPending(false);
        }
    }

    return (
        <DialogRoot
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                    setError(null);
                }
            }}
        >
            <DialogTrigger render={trigger} />
            <DialogPopup title={title} description={description}>
                <div className='flex flex-col gap-3'>
                    {error && (
                        <p role='alert' className='font-body text-danger text-sm'>
                            {error}
                        </p>
                    )}
                    <div className='flex justify-end gap-3'>
                        <DialogClose
                            render={
                                <Button variant='secondary' type='button'>
                                    Cancel
                                </Button>
                            }
                        />
                        <Button type='button' isLoading={isPending} onClick={handleConfirm}>
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </DialogPopup>
        </DialogRoot>
    );
}
