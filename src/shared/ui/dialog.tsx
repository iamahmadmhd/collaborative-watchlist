import type { ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { XMarkIcon } from '@heroicons/react/24/solid';
import { tv } from 'tailwind-variants';

// Design System §3.5: Dialog backs list creation (create-watchlist) and, later,
// destructive confirms (NFR-USE-3) and the add-member flow (select.tsx's own
// comment already anticipates that reuse). One portal/focus model for every
// overlay in the app (§3.5's stated reason a combobox-inside-a-dialog can't break)
// — no caller reaches for @base-ui/react/dialog directly; Root/Trigger/Close are
// re-exported as-is (they render nothing of their own to style), Popup's chrome
// is composed once here.

const dialog = tv({
    slots: {
        backdrop:
            'fixed inset-0 z-50 bg-black/45 transition-opacity duration-150 ' +
            'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
        popup:
            'border-border bg-raised fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 ' +
            '-translate-y-1/2 rounded-[4px] border p-6 shadow-[0_12px_32px_rgba(0,0,0,0.18)] outline-none ' +
            'transition-all duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 ' +
            'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
        header: 'flex items-start justify-between gap-4',
        title: 'font-display text-text m-0 text-lg font-bold tracking-[-0.015em]',
        description: 'text-muted font-body mt-1.5 text-sm',
        close: 'text-muted hover:text-text -mt-1 -mr-1 flex-none',
        body: 'mt-5',
    },
});

export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogPopup({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    const styles = dialog();

    return (
        <BaseDialog.Portal>
            <BaseDialog.Backdrop className={styles.backdrop()} />
            <BaseDialog.Popup className={styles.popup()}>
                <div className={styles.header()}>
                    <div className='flex flex-col'>
                        <BaseDialog.Title className={styles.title()}>{title}</BaseDialog.Title>
                        {description && (
                            <BaseDialog.Description className={styles.description()}>
                                {description}
                            </BaseDialog.Description>
                        )}
                    </div>
                    <BaseDialog.Close aria-label='Close' className={styles.close()}>
                        <XMarkIcon className='size-5' />
                    </BaseDialog.Close>
                </div>
                <div className={styles.body()}>{children}</div>
            </BaseDialog.Popup>
        </BaseDialog.Portal>
    );
}
