import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Ban, Code, FileCheck2, KeyRound, Repeat2, ShieldCheck } from 'lucide-react';
import { Backdrop } from '@/components/Backdrop';
import { Button } from '@/components/ui/primitives';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { RailDiagram } from '@/components/landing/RailDiagram';
import { RefusalDemo } from '@/components/landing/RefusalDemo';
import { StatBand } from '@/components/landing/StatBand';
import { motionTokens, springs } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

const REPO = 'https://github.com/vi5hal-11/UPI-Trust-Layer';

/**
 * amount: 0 fires the moment any pixel enters, so fast scrolling can never
 * strand a section at opacity 0. On a landing page, content that might not
 * appear is far worse than content that does not animate.
 */
function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-faint">
      {children}
    </p>
  );
}

/** The three controls that decide whether money moves. */
const PRIMARY = [
  {
    icon: ShieldCheck,
    title: 'Spend caps',
    body: 'Per transaction and per month. The month’s spend is recomputed from the audit trail rather than cached, so it cannot drift out of step with what was actually paid.',
  },
  {
    icon: Ban,
    title: 'Category rules',
    body: 'An allow list and a deny list, and deny always wins. Adding a category to the allow list can never quietly widen what the agent is able to buy.',
  },
  {
    icon: FileCheck2,
    title: 'Human step-up',
    body: 'Anything over the threshold is parked, never paid. Policy is re-evaluated at approval time, so a stale approval cannot overspend a cap that moved while it waited.',
  },
];

/** Properties that fall out of the three above. Deliberately quieter. */
const SECONDARY = [
  {
    icon: KeyRound,
    title: 'Tamper-evident mandate',
    body: 'Scoped and expiring. Edit it after issuance and the integrity hash stops matching — everything blocks.',
  },
  {
    icon: Repeat2,
    title: 'Idempotent retries',
    body: 'A retried intent replays its original decision. One intent can never become two payments.',
  },
  {
    icon: Ban,
    title: 'Every reason, not the first',
    body: 'A hard violation always beats a step-up, so nobody can be talked into approving what the mandate forbids.',
  },
];

const LIMITS = [
  'Test mode only, permanently. A key that is not a Razorpay test key is refused at startup, and there is no flag to override it.',
  'The mandate is AP2-shaped — scoped, expiring, tamper-evident — with a SHA-256 integrity hash standing in for signature verification. It detects an edited file. It does not prove who issued one.',
  'Step-up approval is a button in the dashboard, not an SMS or a push. The policy re-check is real; the notification channel is not built.',
  'One mandate, one holder, one SQLite file. There is no multi-tenancy and no identity system.',
  'Rate limiting is in-process. It stops a script hammering the demo, not a distributed attacker.',
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
        <section className="grid items-center gap-12 pt-16 pb-14 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <Reveal>
              <SectionLabel>Agentic commerce &middot; Razorpay</SectionLabel>
            </Reveal>

            <Reveal delay={0.05}>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.06] tracking-[-0.032em] sm:text-[48px]">
                An AI agent can spend your money.
                <br />
                <span className="text-text-dim">This decides whether it may.</span>
              </h1>
            </Reveal>

            <Reveal delay={0.1}>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-text-dim">
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
          </div>

          <DashboardPreview />
        </section>

        {/* ---------------------------------------------------- stat band -- */}
        <Reveal>
          <StatBand />
        </Reveal>

        {/* ------------------------------------------------------- problem -- */}
        <section className="mt-16 border-t border-hairline py-16">
          <Reveal>
            <SectionLabel>The problem</SectionLabel>
            <h2 className="mt-3 max-w-2xl text-[26px] font-semibold tracking-[-0.022em]">
              A prompt is guidance. It is not a boundary.
            </h2>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <p className="text-[14px] leading-relaxed text-text-dim">
                NPCI has been developing UPI Agentic Payments, and Razorpay is piloting
                agent-initiated payments. The rails are arriving. The open question is not
                whether an agent can pay &mdash; it is what happens the first time it tries to
                pay for the wrong thing.
              </p>
              <p className="text-[14px] leading-relaxed text-text-dim">
                The usual answer is to write the limits into a system prompt. That holds until
                the first jailbreak, the first confused tool call, or the first genuinely
                ambiguous instruction. Then it holds nothing at all, and the failure is a
                payment.
              </p>
            </div>
          </Reveal>
        </section>

        {/* --------------------------------------------------- the mechanism -- */}
        {/* Given visual primacy on purpose: this is the one idea a reader must
            leave with, so it gets its own ground rather than being the third of
            six identical blocks. */}
        <section className="-mx-5 border-y border-hairline bg-bg-subtle px-5 py-16">
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <SectionLabel>The mechanism</SectionLabel>
              <h2 className="mt-3 max-w-2xl text-[26px] font-semibold tracking-[-0.022em]">
                The model never touches Razorpay.
              </h2>
              <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-text-dim">
                It may request anything. A pure function decides, the decision is identical
                every time, and the result is written down either way. Watch the same request
                take two different endings.
              </p>
            </Reveal>

            <Reveal delay={0.05}>
              <div className="mt-8">
                <RailDiagram />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------ enforced -- */}
        <section className="border-b border-hairline py-16">
          <Reveal>
            <SectionLabel>What it enforces</SectionLabel>
            <h2 className="mt-3 text-[26px] font-semibold tracking-[-0.022em]">
              Three controls decide whether money moves
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PRIMARY.map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.05, 0.15)}>
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={springs.snappy}
                  className="h-full rounded-xl border border-hairline bg-panel p-5"
                >
                  <item.icon size={18} className="text-brand" />
                  <h3 className="mt-3.5 text-[15px] font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-text-dim">{item.body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {SECONDARY.map((item, i) => (
              <Reveal key={item.title} delay={Math.min(i * 0.04, 0.12)}>
                <div className="flex h-full gap-3 rounded-xl border border-hairline px-4 py-3.5">
                  <item.icon size={15} className="mt-0.5 shrink-0 text-text-faint" />
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold">{item.title}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-dim">{item.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------- the money shot -- */}
        <section className="border-b border-hairline py-16">
          <Reveal>
            <SectionLabel>What a refusal looks like</SectionLabel>
            <h2 className="mt-3 max-w-2xl text-[26px] font-semibold tracking-[-0.022em]">
              Three rules break at once, and it reports all three
            </h2>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-text-dim">
              The agent asks for a &#8377;15,000 mechanical keyboard against a mandate that caps
              transactions at &#8377;2,000 and denies electronics &mdash; not the first reason
              it happened to check.
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="mt-8">
              <RefusalDemo />
            </div>
          </Reveal>
        </section>

        {/* ----------------------------------------------------- honesty ---- */}
        <section className="border-b border-hairline py-16">
          <Reveal>
            <SectionLabel>Scope</SectionLabel>
            <h2 className="mt-3 text-[26px] font-semibold tracking-[-0.022em]">
              What this deliberately is not
            </h2>
            <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-text-dim">
              A demo that volunteers its own limits is easier to trust than one that does not.
            </p>
            <ul className="mt-6 grid max-w-3xl gap-3.5">
              {LIMITS.map((line) => (
                <li key={line} className="flex gap-3 text-[13.5px] leading-relaxed text-text-dim">
                  <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-text-faint" />
                  {line}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* --------------------------------------------------------- cta ---- */}
        <section className="py-16">
          <Reveal>
            <div className="rounded-xl border border-hairline bg-panel p-9 text-center">
              <h2 className="text-[24px] font-semibold tracking-[-0.022em]">
                Watch it refuse a purchase
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[14px] leading-relaxed text-text-dim">
                The dashboard is live and readable by anyone. Every decision in it was made by
                the policy engine, and every order was really created against Razorpay test
                mode.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
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
