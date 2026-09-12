import { forwardRef, useId } from 'react';
import { Field } from '@base-ui/react/field';
import { tv } from 'tailwind-variants';

// Base UI's Field supplies label/description/error ARIA wiring only: validation belongs
// entirely to react-hook-form, so `invalid` and Field.Error's `match` are always driven
// from RHF's fieldState, never Base UI's own `validate`. This wraps a plain <input>, so
// callers spread register() straight onto it — no Controller, unlike Select and OTPField.

const textField = tv({
    slots: {
        root: 'flex flex-col gap-1.5',
        label: 'text-muted font-mono text-[10px] tracking-[0.08em] uppercase',
        control:
            'bg-surface font-body text-text placeholder:text-muted h-11 rounded-[3px] border px-3.25 text-[15px] ' +
            'focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] focus:outline-none',
        description: 'font-body text-muted text-xs',
        error: 'font-body text-danger text-xs',
    },
    variants: {
        invalid: {
            true: { control: 'border-danger shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_18%,transparent)]' },
            false: { control: 'border-border' },
        },
    },
    defaultVariants: {
        invalid: false,
    },
});

export interface TextFieldProps extends Omit<React.ComponentProps<typeof Field.Control>, 'id' | 'className'> {
    // Narrowed from Base UI's `string | ((state) => string | undefined)`: tv()'s merge
    // accepts only a plain ClassNameValue, so a function form would type-check as `any`
    // and then fail at runtime.
    className?: string | undefined;
    rootClassName?: string | undefined;
    labelClassName?: string | undefined;
    descriptionClassName?: string | undefined;
    errorClassName?: string | undefined;
    label: string;
    description?: string;
    // Explicitly `| undefined`: callers pass RHF's `errors.field?.message` directly, and
    // exactOptionalPropertyTypes rejects an explicit undefined against a plain optional.
    errorMessage?: string | undefined;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
    {
        label,
        description,
        errorMessage,
        className,
        rootClassName,
        labelClassName,
        descriptionClassName,
        errorClassName,
        ...inputProps
    },
    ref,
) {
    const id = useId();
    const hasError = !!errorMessage;
    const styles = textField({ invalid: hasError });

    return (
        <Field.Root invalid={hasError} className={styles.root({ className: rootClassName })}>
            <Field.Label htmlFor={id} className={styles.label({ className: labelClassName })}>
                {label}
            </Field.Label>
            <Field.Control id={id} ref={ref} className={styles.control({ className })} {...inputProps} />
            {description && !hasError && (
                <Field.Description className={styles.description({ className: descriptionClassName })}>
                    {description}
                </Field.Description>
            )}
            <Field.Error match={hasError} className={styles.error({ className: errorClassName })}>
                {errorMessage}
            </Field.Error>
        </Field.Root>
    );
});
