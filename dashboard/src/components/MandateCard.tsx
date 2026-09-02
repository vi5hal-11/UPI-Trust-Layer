import { Card, CardHeading } from '@/components/ui/primitives';
import { inr, shortDay } from '@/lib/utils';
import type { DashboardState } from '@/lib/api';

export function MandateCard({ mandate }: { mandate: DashboardState['mandate'] }) {
  const scope = mandate.scope;

  const rows: Array<[string, string]> = [
    ['Per purchase', inr(scope.per_transaction_cap_inr)],
    ['Per month', inr(scope.monthly_cap_inr)],
    ['Needs your approval over', inr(scope.step_up_threshold_inr)],
    ['Holder', mandate.principal],
    ['Expires', shortDay(mandate.expires_at)],
    ['Integrity', `${mandate.integrity_hash.slice(0, 12)}…`],
  ];

  return (
    <Card className="p-5">
      <CardHeading>Mandate in force</CardHeading>

      <dl className="mt-3.5 grid gap-2">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-4 text-[13px]">
            <dt className="text-text-dim">{key}</dt>
            <dd
              className={`tnum m-0 text-right font-semibold ${
                key === 'Expires' && mandate.expired ? 'text-stop' : ''
              }`}
            >
              {value}
              {key === 'Expires' && mandate.expired && ' — EXPIRED'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-hairline pt-4">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-text-faint">
          Can spend on
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {scope.category_allow.length ? (
            scope.category_allow.map((c) => (
              <span
                key={c}
                className="rounded-md border border-ok-line bg-ok-soft px-2 py-0.5 text-[12px] font-medium text-ok"
              >
                {c}
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-text-dim">anything not blocked</span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-text-faint">Never</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {scope.category_deny.map((c) => (
            <span
              key={c}
              className="rounded-md border border-stop-line bg-stop-soft px-2 py-0.5 text-[12px] font-medium text-stop"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
