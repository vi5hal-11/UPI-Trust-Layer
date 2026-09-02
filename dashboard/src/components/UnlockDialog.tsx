import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { motionTokens, springs } from '@/lib/motion';

interface UnlockDialogProps {
  unlocked: boolean;
  onUnlock: (secret: string) => Promise<void>;
  onLock: () => Promise<void>;
}

/**
 * Approvals are the only thing on this dashboard that can move money, so they
 * are the only thing behind a secret. Everything else - the mandate, the
 * budget, every decision ever made - stays readable by anyone, because being
 * able to watch the gatekeeper work is the whole demonstration.
 */
export function UnlockDialog({ unlocked, onUnlock, onLock }: UnlockDialogProps) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUnlock(secret);
      setSecret('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.');
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) {
    return (
      <Button
        variant="ghost"
        onClick={() => void onLock()}
        className="gap-1.5 text-ok"
        title="Approvals are unlocked. Click to lock again."
      >
        <LockOpen size={14} />
        <span className="hidden sm:inline">Approvals unlocked</span>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="gap-1.5">
        <Lock size={14} />
        <span className="hidden sm:inline">Unlock approvals</span>
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: motionTokens.distance.md, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: motionTokens.distance.sm, scale: 0.98 }}
              transition={springs.gentle}
              onClick={(e) => e.stopPropagation()}
              onSubmit={submit}
              className="w-full max-w-sm rounded-xl border border-hairline bg-panel p-5 shadow-2xl"
            >
              <h2 className="text-[14px] font-semibold">Unlock approvals</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-dim">
                Approving a parked purchase releases real money on the payment rail. The
                decision log stays public either way.
              </p>

              <input
                type="password"
                autoFocus
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Approval secret"
                aria-label="Approval secret"
                className="mt-4 w-full rounded-lg border border-hairline-strong bg-bg-subtle px-3 py-2.5 text-[13px] outline-none focus-visible:border-brand"
              />

              {error && <p className="mt-2 text-[12.5px] font-medium text-stop">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy || !secret}>
                  {busy ? 'Checking…' : 'Unlock'}
                </Button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
