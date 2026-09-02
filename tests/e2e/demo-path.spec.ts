import { expect, test } from '@playwright/test';
import { DashboardPage } from './pages/DashboardPage';

/**
 * The demo path: the four scenarios a judge actually watches, asserted in a
 * browser against the real server and the real audit trail.
 *
 * Note on state: the audit trail is append-only and shared, so these tests
 * read the live budget before spending anything and skip (rather than fail)
 * if a previous run has already consumed the monthly cap. Run `npm run demo`
 * to reset to the four seeded scenarios.
 */

test.describe('demo path', () => {
  let dash: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dash = new DashboardPage(page);
    await dash.goto();
  });

  test('a blocked purchase shows every reason it was blocked, not just the first', async () => {
    const blocked = dash.row('blocked').first();
    await expect(blocked).toBeVisible();

    await dash.expand(blocked);

    // CLAUDE.md invariant 3: all violations are collected, not just the first.
    // The seeded 15,000 electronics purchase breaks three rules at once.
    const violations = blocked.getByTestId('violation');
    await expect(violations).toHaveCount(3);

    const codes = (await violations.allInnerTexts()).join(' ');
    expect(codes).toContain('CATEGORY_DENIED');
    expect(codes).toContain('PER_TRANSACTION_CAP_EXCEEDED');
    expect(codes).toContain('MONTHLY_CAP_EXCEEDED');
  });

  test('a blocked purchase never reaches the payment rail', async () => {
    const blocked = dash.row('blocked').first();

    // The rail indicator is the architecture restated per row: the third node
    // is hollow because the gatekeeper stopped the request before Razorpay.
    await expect(blocked.getByTestId('rail')).toHaveAttribute('data-rail-reached', 'false');

    await dash.expand(blocked);
    await expect(blocked.getByTestId('event-detail')).toContainText('no razorpay call');

    // And a purchase policy allowed did reach it.
    const paid = dash.row('allowed').first();
    await expect(paid.getByTestId('rail')).toHaveAttribute('data-rail-reached', 'true');
  });

  test('the segmented filter isolates blocked decisions', async ({ page }) => {
    const total = await dash.events.count();
    expect(total).toBeGreaterThan(1);

    await dash.selectTab('Blocked');

    const shown = dash.events;
    await expect(shown).not.toHaveCount(total);
    for (const row of await shown.all()) {
      await expect(row).toHaveAttribute('data-decision', 'blocked');
    }

    await dash.selectTab('All');
    await expect(dash.events).toHaveCount(total);
    await expect(page.getByRole('tab', { selected: true })).toContainText(/All/i);
  });

  test('a step-up is parked, then re-checked and paid on approval', async ({ page, request }) => {
    const state = await (await request.get('/api/state')).json();
    const threshold = state.mandate.scope.step_up_threshold_inr;
    const perTxnCap = state.mandate.scope.per_transaction_cap_inr;
    const remaining = state.budget.monthly_remaining_inr;

    // Above the approval threshold, inside the per-transaction cap.
    const amount = Math.min(threshold + 100, perTxnCap);
    test.skip(
      remaining < amount,
      `Only ${remaining} of monthly budget left; run "npm run demo" to reset.`,
    );

    const spendBefore: number = state.budget.month_spend_inr;

    // A unique item name per run, so assertions can never match a seeded row.
    const item = `e2e storage plan ${Date.now()}`;

    await dash.attemptPurchase({ item, amount_inr: amount, category: 'subscriptions' });

    // It parks rather than paying, and says so.
    await expect(dash.approvalBanner).toBeVisible();
    await expect(dash.approvalBanner).toContainText(item);
    await expect(dash.approvalBanner).toContainText(/nothing has been paid yet/i);

    const parked = dash.row('step_up_required').filter({ hasText: item });
    await expect(parked.getByTestId('rail')).toHaveAttribute('data-rail-reached', 'false');

    await page.getByRole('button', { name: 'Approve' }).first().click();

    // CLAUDE.md invariant 2: policy is re-evaluated at approval time, and the
    // resolution is a NEW event pointing back at the parked one, not an edit.
    const approved = dash.row('step_up_approved').filter({ hasText: item });
    await expect(approved).toBeVisible();
    await dash.expand(approved);
    await expect(approved.getByTestId('event-detail')).toContainText(
      /re-checked against the mandate/i,
    );
    await expect(approved.getByTestId('rail')).toHaveAttribute('data-rail-reached', 'true');

    // The parked event is still there - the trail is append-only (invariant:
    // "a resolution is a new event pointing back at the one it resolves").
    await expect(parked).toBeVisible();

    // Only money that actually moved counts as spend (invariant 5). Poll: the
    // click returns before the server has committed and re-polled.
    await expect
      .poll(async () => (await (await request.get('/api/state')).json()).budget.month_spend_inr, {
        timeout: 10_000,
      })
      .toBe(spendBefore + amount);
  });

  test('a decision landing while the page is open raises a toast', async () => {
    // The poll primes a baseline on first load; without this the toast would
    // fire for events that were already in the log.
    await expect(dash.events.first()).toBeVisible();

    await dash.attemptPurchase({
      item: 'e2e noise cancelling headphones',
      amount_inr: 24_000,
      category: 'electronics',
    });

    const toast = dash.toasts.first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toContainText('Blocked');
    await expect(toast).toContainText('e2e noise cancelling headphones');

    // A blocked purchase costs nothing, so the headline figure must not move.
    await expect(dash.spendFigure).not.toContainText('24,000');
  });
});
