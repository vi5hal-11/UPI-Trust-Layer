import * as Tabs from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface SegmentOption {
  value: string;
  label: string;
  count: number;
}

interface SegmentedProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentOption[];
}

/**
 * A segmented control on top of Radix Tabs, so keyboard navigation and ARIA
 * come for free. The active pill is a single shared element that slides
 * between segments via layoutId - which is what makes the switch read as one
 * object moving rather than two things blinking.
 */
export function Segmented({ value, onValueChange, options }: SegmentedProps) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-bg-subtle p-1"
        aria-label="Filter decisions"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Tabs.Trigger
              key={option.value}
              value={option.value}
              className={cn(
                'relative rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                active ? 'text-text' : 'text-text-dim hover:text-text',
                option.count === 0 && !active && 'opacity-55',
              )}
            >
              {active && (
                <motion.span
                  layoutId="segmented-active"
                  transition={springs.snappy}
                  className="absolute inset-0 rounded-lg border border-hairline-strong bg-panel shadow-sm"
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {option.label}
                <span
                  className={cn(
                    'tnum rounded-full px-1.5 text-[10.5px] font-bold',
                    active ? 'bg-brand-soft text-brand' : 'bg-mute-soft text-text-faint',
                  )}
                >
                  {option.count}
                </span>
              </span>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
