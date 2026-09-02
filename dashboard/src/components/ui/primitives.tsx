import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ card -- */

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-hairline bg-panel',
        'shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4)]',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export function CardHeading({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-[10.5px] font-bold uppercase tracking-[0.09em] text-text-faint',
        className,
      )}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------- badge -- */

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-hairline-strong bg-bg-subtle text-text-dim',
        brand: 'border-brand-line bg-brand-soft text-brand',
        ok: 'border-ok-line bg-ok-soft text-ok',
        stop: 'border-stop-line bg-stop-soft text-stop',
        wait: 'border-wait-line bg-wait-soft text-wait',
        fail: 'border-fail-line bg-fail-soft text-fail',
        mute: 'border-mute-line bg-mute-soft text-mute',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ---------------------------------------------------------------- button -- */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-[13px] font-semibold ' +
    'transition-colors disabled:opacity-50 disabled:pointer-events-none select-none',
  {
    variants: {
      variant: {
        default: 'border border-hairline-strong bg-panel text-text hover:bg-bg-subtle',
        primary: 'bg-ok text-white hover:brightness-110 dark:text-[#04210f]',
        // Brand blue, for calls to action. Deliberately NOT the green above:
        // green means "paid" everywhere else in this product.
        brand: 'bg-brand text-white hover:brightness-110',
        ghost: 'text-text-dim hover:bg-bg-subtle hover:text-text',
      },
      size: {
        // A real hit area, not an icon-sized one.
        default: 'h-10 px-4',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
