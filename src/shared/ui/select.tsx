import { Select as BaseSelect } from '@base-ui/react/select';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { tv } from 'tailwind-variants';

// Design System §3.5 names Select for "genre filter; role selection" — this is
// its one wrapper, used by every caller (filter-discovery's genre picker first;
// watchlist role selection and the add-member dialog reuse it later). Visual
// language matches docs/design/ (Discovery.dc.html): 38px trigger, 3px radius,
// hairline border, monospace chevron. Uncontrolled label lookup is avoided —
// callers pass `items` and this renders the matching label via Select.Value's
// render-prop, so the trigger never goes stale relative to the popup's options.

const select = tv({
    slots: {
        trigger:
            'border-border bg-raised text-text font-body inline-flex h-9.5 items-center gap-2 rounded-[3px] border ' +
            'data-[popup-open]:border-accent px-3 text-sm focus:outline-none ' +
            'focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)]',
        icon: 'text-muted text-[9px]',
        positioner: 'z-50',
        popup:
            'border-border bg-raised max-h-64 min-w-[var(--anchor-width)] overflow-auto rounded-[3px] border py-1 ' +
            'shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
        item: 'text-text font-body data-[highlighted]:bg-surface flex cursor-pointer items-center px-3 py-2 text-sm',
    },
});

export interface SelectItem<Value extends string> {
    value: Value;
    label: string;
}

export interface SelectProps<Value extends string> {
    items: SelectItem<Value>[];
    value: Value;
    onValueChange: (value: Value) => void;
    placeholder?: string;
    'aria-label': string;
    className?: string;
}

export function Select<Value extends string>({
    items,
    value,
    onValueChange,
    placeholder,
    className,
    ...triggerProps
}: SelectProps<Value>) {
    const styles = select();

    return (
        <BaseSelect.Root items={items} value={value} onValueChange={(next) => onValueChange(next as Value)}>
            <BaseSelect.Trigger className={styles.trigger({ className })} {...triggerProps}>
                <BaseSelect.Value placeholder={placeholder}>
                    {() => items.find((item) => item.value === value)?.label ?? placeholder}
                </BaseSelect.Value>
                <BaseSelect.Icon className={styles.icon()}>
                    <ChevronDownIcon className='size-4' />
                </BaseSelect.Icon>
            </BaseSelect.Trigger>
            <BaseSelect.Portal>
                <BaseSelect.Positioner className={styles.positioner()} sideOffset={6}>
                    <BaseSelect.Popup className={styles.popup()}>
                        <BaseSelect.List>
                            {items.map((item) => (
                                <BaseSelect.Item key={item.value} value={item.value} className={styles.item()}>
                                    <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                                </BaseSelect.Item>
                            ))}
                        </BaseSelect.List>
                    </BaseSelect.Popup>
                </BaseSelect.Positioner>
            </BaseSelect.Portal>
        </BaseSelect.Root>
    );
}
