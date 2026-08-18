import { forwardRef, useId } from 'react';
import { Field } from '@base-ui/react/field';
import { tv } from 'tailwind-variants';

// Design System §3.5, §2.5. Base UI's Field provides label/description/error ARIA
// wiring only — validation ownership belongs entirely to react-hook-form + Zod
// (System Design §2.5). `invalid` and the Field.Error `match` prop are therefore
// always driven from RHF's fieldState, never from Base UI's own `validate`.
// "Native inputs use a register" (§2.5) — this wraps a plain <input> via
// Field.Control, so callers spread react-hook-form's register() return value
// directly onto it; no Controller needed here (unlike Select/Combobox/OTPField).
//
// Visual language matches docs/design/ (Auth.dc.html) as of v1.2: monospace
// uppercase label, 3px radius, accent focus ring via color-mix. Applied via CSS
// text-transform rather than requiring callers to pass pre-uppercased label text.

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
    // Narrowed from Base UI's `string | ((state) => string | undefined)`: tv()'s
    // className merge only accepts plain ClassNameValue (string/array), and no
    // caller in this codebase needs the function-of-state form — passing one
    // through unchanged would type-check as `any` and fail at runtime, not just
    // at the type level.
    className?: string | undefined;
    label: string;
    description?: string;
    // Explicitly `| undefined`, not just optional: callers pass RHF's
    // `errors.field?.message` (typed `string | undefined`) directly, and this
    // project has `exactOptionalPropertyTypes` on — `errorMessage?: string`
    // alone rejects an explicit `undefined`, only an omitted property.
    errorMessage?: string | undefined;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
    { label, description, errorMessage, className, ...inputProps },
    ref,
) {
    const id = useId();
    const hasError = !!errorMessage;
    const styles = textField({ invalid: hasError });

    return (
        <Field.Root invalid={hasError} className={styles.root()}>
            <Field.Label htmlFor={id} className={styles.label()}>
                {label}
            </Field.Label>
            <Field.Control id={id} ref={ref} className={styles.control({ className })} {...inputProps} />
            {description && !hasError && (
                <Field.Description className={styles.description()}>{description}</Field.Description>
            )}
            <Field.Error match={hasError} className={styles.error()}>
                {errorMessage}
            </Field.Error>
        </Field.Root>
    );
});
