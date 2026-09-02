import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the audit dashboard.
 *
 * Selectors prefer role and text over CSS wherever the markup already carries
 * the right semantics, and fall back to data-testid only where a decision type
 * has to be addressed directly.
 */
export class DashboardPage {
  readonly page: Page;
  readonly modeBadge: Locator;
  readonly events: Locator;
  readonly approvalBanner: Locator;
  readonly spendFigure: Locator;
  readonly toasts: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modeBadge = page.getByTestId('mode-badge');
    this.events = page.getByTestId('event');
    this.approvalBanner = page.getByTestId('approval-banner');
    this.spendFigure = page.getByTestId('spend-figure');
    this.toasts = page.locator('[data-sonner-toast]');
  }

  async goto() {
    // The dashboard moved to /dashboard when the landing page took over /.
    await this.page.goto('/dashboard');
    // The first paint happens before the first poll resolves, so wait for real
    // data rather than a load event.
    await this.events.first().waitFor({ state: 'visible' });
  }

  /** All rows for one decision type, e.g. 'blocked'. */
  row(decision: string): Locator {
    return this.page.locator(`[data-testid="event"][data-decision="${decision}"]`);
  }

  /** The clickable summary line of a row. */
  rowToggle(row: Locator): Locator {
    return row.locator('button[aria-expanded]');
  }

  async expand(row: Locator) {
    const toggle = this.rowToggle(row);
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await row.getByTestId('event-detail').waitFor({ state: 'visible' });
  }

  tab(name: string): Locator {
    return this.page.getByRole('tab', { name: new RegExp(`^${name}`, 'i') });
  }

  async selectTab(name: string) {
    await this.tab(name).click();
    // Radix marks the active tab; wait for it rather than for a fixed delay.
    await this.page
      .locator(`[role="tab"][aria-selected="true"]`)
      .filter({ hasText: new RegExp(name, 'i') })
      .waitFor();
  }

  /**
   * Approvals are gated. Unlocking through the API rather than the dialog
   * keeps the money-path tests focused on policy, not on typing into a form -
   * the dialog itself is covered by the rejection test.
   */
  async unlockApprovals() {
    const secret = process.env.APPROVAL_SECRET;
    if (!secret) throw new Error('APPROVAL_SECRET is not set; cannot unlock approvals.');
    const res = await this.page.request.post('/api/session', { data: { secret } });
    if (!res.ok()) throw new Error(`Unlock failed: ${res.status()}`);
    await this.page.reload();
    await this.events.first().waitFor({ state: 'visible' });
  }

  /** Drive a purchase through the real API, as the agent would. */
  async attemptPurchase(body: {
    item: string;
    amount_inr: number;
    category: string;
    merchant?: string;
  }) {
    const res = await this.page.request.post('/api/intent', { data: body });
    if (!res.ok()) throw new Error(`POST /api/intent failed: ${res.status()}`);
    return res.json();
  }
}
