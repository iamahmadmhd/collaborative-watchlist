import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field } from '@base-ui/react/field';
import { OTPField } from '@base-ui/react/otp-field';
import { tv } from 'tailwind-variants';

// Design System §3.5, ADR-003, System Design §2.5. OTPField requires Controller —
// that wiring lives here, once, so pages just pass `control`/`name` like any other
// field (FR-AUTH-2: email verification code entry). Box styling matches
// docs/design/ (Auth.dc.html) as of v1.2 — equal-width monospace slots, accent
// focus ring via color-mix.
//
// No discrete variant here (unlike Button/TextField) — the invalid state is
// already reflected via Base UI's own `data-invalid` attribute on each slot, so
// `slots` alone (no `variants`) is the right amount of tailwind-variants to use.

const otpField = tv({
    slots: {
        root: 'flex flex-col gap-1.5',
        label: 'text-muted font-mono text-[10px] tracking-[0.08em] uppercase',
        group: 'flex gap-2',
        // min-w-0 is load-bearing: a flex item's default min-width is `auto`, which
        // for an <input> is its intrinsic content width (~20ch in most browsers) —
        // flex-1 alone can't shrink it below that, so without this the six slots
        // overflow their container instead of sharing it equally (verified in-browser).
        slot: 'border-border bg-surface text-text focus:border-accent data-[invalid]:border-danger h-14 min-w-0 flex-1 rounded-[3px] border text-center font-mono text-2xl focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] focus:outline-none',
        error: 'font-body text-danger text-xs',
    },
});

const styles = otpField();

export interface OtpFieldProps<TFieldValues extends FieldValues> {
    control: Control<TFieldValues>;
    name: FieldPath<TFieldValues>;
    label: string;
    length?: number;
}

export function OtpField<TFieldValues extends FieldValues>({
    control,
    name,
    label,
    length = 6,
}: OtpFieldProps<TFieldValues>) {
    const {
        field: { value, onChange, onBlur },
        fieldState,
    } = useController({ control, name });
    const hasError = !!fieldState.error;

    return (
        <Field.Root invalid={hasError} className={styles.root()}>
            <Field.Label className={styles.label()}>{label}</Field.Label>
            <OTPField.Root
                length={length}
                value={(value as string | undefined) ?? ''}
                onValueChange={(next) => onChange(next)}
                onBlur={onBlur}
                className={styles.group()}
            >
                {Array.from({ length }, (_, index) => (
                    <OTPField.Input key={index} className={styles.slot()} />
                ))}
            </OTPField.Root>
            <Field.Error match={hasError} className={styles.error()}>
                {fieldState.error?.message}
            </Field.Error>
        </Field.Root>
    );
}
