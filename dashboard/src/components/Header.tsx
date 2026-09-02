import { Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge, Button } from '@/components/ui/primitives';
import { springs } from '@/lib/motion';
import type { DashboardState } from '@/lib/api';

interface HeaderProps {
  mode: DashboardState['mode'] | null;
  dark: boolean;
  onToggleTheme: () => void;
  approvals: React.ReactNode;
}

/**
 * The one place glass is used heavily. Everything below it is solid, because
 * the evidence needs contrast more than it needs translucency.
 */
export function Header({ mode, dark, onToggleTheme, approvals }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-panel-glass backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">UPI Agent Trust Layer</h1>
          <p className="text-[12.5px] text-text-dim">
            Every payment an AI agent attempted, and why it was allowed or stopped.
          </p>
        </div>

        <div className="flex-1" />

        <div className="flex flex-wrap items-center gap-2">
          {mode && (
            <>
              <Badge tone={mode.live ? 'ok' : 'brand'} data-testid="mode-badge">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-current"
                  animate={{ opacity: [1, 0.35, 1] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
                {'Razorpay test mode'}
              </Badge>
              <Badge tone="neutral">
                {mode.agent_available ? `agent: ${mode.agent_model}` : 'direct mode · no LLM'}
              </Badge>
            </>
          )}

          {approvals}

          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <motion.span
              key={dark ? 'moon' : 'sun'}
              initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              transition={springs.snappy}
              className="flex"
            >
              {dark ? <Moon size={16} /> : <Sun size={16} />}
            </motion.span>
          </Button>
        </div>
      </div>
    </header>
  );
}
