import type { ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { CheckIcon } from '@heroicons/react/24/solid';
import { tv } from 'tailwind-variants';

// The one Menu wrapper, so no caller reaches for @base-ui/react/menu directly. Its
// checkbox-item form is what the add-to-list picker needs: a movie can be toggled into
// several lists without the menu closing, which Select's single-value model cannot do.

const menu = tv({
    slots: {
        positioner: 'z-50',
        popup:
            'border-border bg-raised max-h-72 min-w-56 overflow-auto rounded-[3px] border py-1 ' +
            'shadow-[0_12px_32px_rgba(0,0,0,0.18)] outline-none',
        item: 'text-text font-body data-[highlighted]:bg-surface flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm outline-none',
        indicator: 'text-accent flex size-4 flex-none items-center justify-center',
    },
});

export const MenuRoot = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuPopup({ children }: { children: ReactNode }) {
    const styles = menu();

    return (
        <BaseMenu.Portal>
            <BaseMenu.Positioner className={styles.positioner()} sideOffset={6}>
                <BaseMenu.Popup className={styles.popup()}>{children}</BaseMenu.Popup>
            </BaseMenu.Positioner>
        </BaseMenu.Portal>
    );
}

export function MenuCheckboxItem({
    checked,
    onCheckedChange,
    disabled,
    children,
}: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    children: ReactNode;
}) {
    const styles = menu();

    return (
        <BaseMenu.CheckboxItem
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            closeOnClick={false}
            className={styles.item()}
        >
            {children}
            <BaseMenu.CheckboxItemIndicator className={styles.indicator()}>
                <CheckIcon className='size-3.5' />
            </BaseMenu.CheckboxItemIndicator>
        </BaseMenu.CheckboxItem>
    );
}
