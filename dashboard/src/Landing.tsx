import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Ban, Code, FileCheck2, KeyRound, Repeat2, ShieldCheck } from 'lucide-react';
import { Backdrop } from '@/components/Backdrop';
import { Button } from '@/components/ui/primitives';
import { motionTokens, springs } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

const REPO = 'https://github.com/vi5hal-11/UPI-Trust-Layer';

/** Staggered entrance without repeating the transition on every element. */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();

  // amount: 0 fires the moment any pixel enters, so fast scrolling can never
  // strand a section at opacity 0. On a landing page, content that might not
  // appear is far worse than content that does not animate.
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.md }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0 }}
      transition={reduce ? { duration: motionTokens.duration.fast } : { ...springs.gentle, delay }}
    >
      {children}
    </motion.div>
  );
}

const ENFORCED = [
  {
    icon: ShieldCheck,
    title: 'Spend caps',
    body: 'Per transaction and per month. The month’s spend is recomputed from the audit trail, not cached, so it cannot drift.',
  },
  {
    icon: Ban,
    title: 'Category rules',
    body: 'An allow list and a deny list. Deny always wins, so adding a category to the allow list can never widen what the agent may buy.',
  },
  {
    icon: FileCheck2,
    title: 'Human step-up',
    body: 'Anything over the threshold is parked, not paid. Policy is re-checked at approval time — a stale approval cannot overspend the cap.',
  },
  {
    icon: KeyRound,
    title: 'Scoped mandate',
    body: 'Expiring and tamper-evident. Edit the mandate after issuance and the integrity hash stops matching, and everything is blocked.',
  },
  {
    icon: Repeat2,
    title: 'Idempotent retries',
    body: 'An agent that retries after a timeout replays its original decision. One intent can never become two payments.',
  },
  {
    icon: Ban,
    title: 'All reasons, not the first',
    body: 'A purchase that breaks three rules reports three. A hard violation always beats a step-up, so nobody can be talked into approving what the mandate forbids.',
  },
];

export default function Landing() {
  const { dark, toggle } = useTheme();

  return (
    <>
      <Backdrop />

      <header className="sticky top-0 z-30 border-b border-hairline bg-panel-glass backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3.5">
          <span className="text-[14px] font-semibold tracking-[-0.01em]">
            UPI Agent Trust Layer
          </span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {dark ? 'Light' : 'Dark'}
          </Button>
          <a href={REPO} target="_blank" rel="noreferrer">
            <Button variant="ghost" className="gap-1.5">
              <Code size={14} />
              <span className="hidden sm:inline">Source</span>
            </Button>
          </a>
          <a href="/dashboard">
            <Button variant="brand" className="gap-1.5">
              Open dashboard <ArrowRight size={14} />
            </Button>
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24">
        {/* ---------------------------------------------------------- hero -- */}
        <section className="pt-20 pb-16 sm:pt-28">
          <Reveal>
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-brand">
              Agentic commerce &middot; Razorpay
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[52px]">
              An AI agent can spend your money.
              <br />
              <span className="text-text-dim">This decides whether it may.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-text-dim">
              A deterministic policy gatekeeper between a shopping agent and Razorpay. Spend
              caps, category rules and human confirmation are enforced in code, not in a
              prompt &mdash; and every decision, allowed or refused, is written to an
              append-only audit trail.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/dashboard">
                <Button variant="brand" className="gap-1.5">
                  See it decide <ArrowRight size={14} />
                </Button>
              </a>
              <a href={REPO} target="_blank" rel="noreferrer">
                <Button className="gap-1.5">
                  <Code size={14} /> Read the code
                </Button>
              </a>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------- problem -- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              The permission problem
            </h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <p className="text-[14px] leading-relaxed text-text-dim">
                NPCI has been developing UPI Agentic Payments, and Razorpay is piloting
                agent-initiated payments. The rails are arriving. The open question is not
                whether an agent can pay &mdash; it is what happens when it tries to pay for
                the wrong thing.
              </p>
              <p className="text-[14px] leading-relaxed text-text-dim">
                The usual answer is to write the limits into a system prompt. That holds
                until the first jailbreak, the first confused tool call, or the first
                genuinely ambiguous instruction. A prompt is guidance. It is not a
                boundary.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------- the one rule -- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              One rule governs the design
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed">
              <strong className="font-semibold">The model never touches Razorpay.</strong>{' '}
              <span className="text-text-dim">
                Its entire capability surface is a single tool. It holds no key, no
                endpoint, and no import path to the payment client. It may request anything;
                a pure function decides; the decision is identical every time.
              </span>
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-8 overflow-x-auto rounded-xl border border-hairline bg-panel p-5">
              <pre className="min-w-[640px] font-mono text-[12px] leading-relaxed text-text-dim">
{`  user  ──▶  Shopping agent (LLM)  ──▶  [ attempt_purchase ]  ──▶  Gatekeeper  ──▶  Razorpay
                 no keys, no rails          the only door         deterministic     test mode
                                                                       │
                                                                       ▼
                                                             Append-only audit trail`}
              </pre>
            </div>
          </Reveal>
        </section>

        {/* ------------------------------------------------------ enforced -- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              What the gatekeeper enforces
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ENFORCED.map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.04, 0.2)}>
                <div className="h-full rounded-xl border border-hairline bg-panel p-5">
                  <item.icon size={17} className="text-brand" />
                  <h3 className="mt-3 text-[14px] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------- the money shot -- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              What a refusal looks like
            </h2>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-text-dim">
              The agent asks for a &#8377;15,000 mechanical keyboard against a mandate that
              caps transactions at &#8377;2,000 and denies electronics. Three rules break at
              once, and it reports all three &mdash; not the first one it happened to check.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-6 overflow-hidden rounded-xl border border-hairline bg-panel">
              <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
                <span className="rounded-full border border-stop-line bg-stop-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] text-stop">
                  blocked
                </span>
                <span className="text-[13.5px] font-semibold">mechanical gaming keyboard</span>
                <span className="flex-1" />
                <span className="tnum text-[14px] font-semibold">&#8377;15,000</span>
              </div>
              <div className="grid gap-1.5 p-4">
                {[
                  ['CATEGORY_DENIED', "'electronics' is on the blocked list for this mandate"],
                  ['PER_TRANSACTION_CAP_EXCEEDED', '₹15,000 is over the ₹2,000 per-transaction cap'],
                  [
                    'MONTHLY_CAP_EXCEEDED',
                    "this would take September's spending to ₹18,800, over the ₹10,000 monthly cap",
                  ],
                ].map(([code, message]) => (
                  <div
                    key={code}
                    className="flex items-start gap-2.5 rounded-md border border-stop-line bg-stop-soft px-2.5 py-1.5 text-[12.5px] text-text-dim"
                  >
                    <code className="whitespace-nowrap pt-px font-mono text-[10.5px] font-bold text-stop">
                      {code}
                    </code>
                    <span>{message}</span>
                  </div>
                ))}
                <p className="mt-2 font-mono text-[11px] text-text-faint">
                  0 calls to Razorpay &middot; refused before the rail, not after
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ----------------------------------------------------- honesty ---- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">
              What this deliberately is not
            </h2>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-text-dim">
              A demo that volunteers its own limits is easier to trust than one that does
              not.
            </p>
            <ul className="mt-5 grid max-w-3xl gap-3">
              {[
                'Test mode only, permanently. A key that is not a Razorpay test key is refused at startup, with no override flag.',
                'The mandate is AP2-shaped — scoped, expiring, tamper-evident — with a SHA-256 integrity hash standing in for signature verification. It detects an edited file; it does not prove who issued one.',
                'Step-up approval is a button in the dashboard, not an SMS or a push. The policy re-check is real; the notification channel is not built.',
                'One mandate, one holder, one SQLite file. There is no multi-tenancy and no identity system.',
                'Rate limiting is in-process. It stops a script hammering the demo, not a distributed attacker.',
              ].map((line) => (
                <li key={line} className="flex gap-3 text-[13.5px] leading-relaxed text-text-dim">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-faint" />
                  {line}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* --------------------------------------------------------- cta ---- */}
        <section className="border-t border-hairline py-16">
          <Reveal>
            <div className="rounded-xl border border-hairline bg-panel p-8 text-center">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
                Watch it refuse a purchase
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[14px] leading-relaxed text-text-dim">
                The dashboard is live and read-only for everyone. Every decision in it was
                made by the policy engine, and every order was really created against
                Razorpay test mode.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <a href="/dashboard">
                  <Button variant="brand" className="gap-1.5">
                    Open the audit dashboard <ArrowRight size={14} />
                  </Button>
                </a>
                <a href={REPO} target="_blank" rel="noreferrer">
                  <Button className="gap-1.5">
                    <Code size={14} /> Source
                  </Button>
                </a>
              </div>
            </div>
          </Reveal>
        </section>

        <footer className="border-t border-hairline pt-8 text-[11.5px] text-text-faint">
          Built for the Razorpay AI Buildathon, Track 01. Razorpay test mode throughout &mdash;
          no real money can move.
        </footer>
      </main>
    </>
  );
}
