import { expect, test } from '@playwright/test';

/**
 * The landing page is what a recruiter or a judge sees first, so the things
 * asserted here are the things that would embarrass the project if they broke:
 * the page renders at all, the route into the tool works, and the honest
 * limitations section has not quietly disappeared.
 */

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('states the thesis above the fold', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /an ai agent can spend your money/i,
    );
    await expect(page.getByText(/the model never touches razorpay/i)).toBeVisible();
  });

  test('every section renders - none stranded invisible by the scroll reveal', async ({ page }) => {
    const headings = [
      /the permission problem/i,
      /one rule governs the design/i,
      /what the gatekeeper enforces/i,
      /what a refusal looks like/i,
      /what this deliberately is not/i,
    ];
    for (const heading of headings) {
      const node = page.getByRole('heading', { name: heading });
      await node.scrollIntoViewIfNeeded();
      await expect(node).toBeVisible();
    }
  });

  test('the refusal example shows all three violation codes', async ({ page }) => {
    // This is the story the page is selling; if it regresses the page is lying.
    await expect(page.getByText('CATEGORY_DENIED')).toBeVisible();
    await expect(page.getByText('PER_TRANSACTION_CAP_EXCEEDED')).toBeVisible();
    await expect(page.getByText('MONTHLY_CAP_EXCEEDED')).toBeVisible();
  });

  test('keeps the honest limitations visible', async ({ page }) => {
    await expect(page.getByText(/test mode only, permanently/i)).toBeVisible();
    await expect(page.getByText(/does not prove who issued one/i)).toBeVisible();
  });

  test('leads into the dashboard, and a direct link to it survives a reload', async ({ page }) => {
    await page.getByRole('link', { name: /see it decide/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // SPA fallback: refreshing a deep link must not 404.
    await page.reload();
    await expect(page.getByTestId('event').first()).toBeVisible();
  });
});
