import { forwardRef } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { tv, type VariantProps } from 'tailwind-variants';

// Design System §3.5. Base UI Button supplies focus/press behaviour; token-based
// variants are applied here so no caller reaches for @base-ui/react directly.
// Sizing/radius matches docs/design/ (Auth.dc.html) as of v1.2.

const button = tv({
    base: 'font-body inline-flex h-11.5 items-center justify-center rounded-[3px] px-4 text-[15px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60',
    variants: {
        variant: {
            primary: 'bg-accent text-accent-contrast hover:opacity-90',
            secondary: 'border-border text-text hover:bg-raised border bg-transparent',
        },
    },
    defaultVariants: {
        variant: 'primary',
    },
});

export interface ButtonProps
    extends Omit<React.ComponentProps<typeof BaseButton>, 'className'>, VariantProps<typeof button> {
    // Narrowed from Base UI's `string | ((state) => string | undefined)`: tv()'s
    // className merge only accepts plain ClassNameValue (string/array), and no
    // caller in this codebase needs the function-of-state form — passing one
    // through unchanged would type-check as `any` and fail at runtime, not just
    // at the type level.
    className?: string | undefined;
    isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant, isLoading = false, disabled, className, children, ...props },
    ref,
) {
    return (
        <BaseButton ref={ref} disabled={disabled || isLoading} className={button({ variant, className })} {...props}>
            {isLoading ? 'Please wait…' : children}
        </BaseButton>
    );
});
