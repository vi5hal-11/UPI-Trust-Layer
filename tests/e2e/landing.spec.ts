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
    // The hero carries a live miniature of the product, not a stale screenshot.
    await expect(page.getByText('/dashboard', { exact: true })).toBeVisible();
  });

  test('the stat band reports real figures, not literals someone has to remember', async ({
    page,
    request,
  }) => {
    // Deliberately no magic numbers here. Asserting "68" was how the page came
    // to claim 68 tests when there were 78: the number and its test drifted
    // together, so the test proved nothing. Assert the PROPERTY instead - that
    // the figures shown match what the running service actually reports.
    await expect(page.getByText(/unit tests on the trust boundary/i)).toBeVisible();
    await expect(page.getByText(/decisions on the live audit trail/i)).toBeVisible();
    await expect(page.getByText(/they are not claims/i)).toBeVisible();

    const state = await (await request.get('/api/state')).json();

    // The live decision count must appear, counted up from the real trail.
    const band = page.getByText(/decisions on the live audit trail/i).locator('..');
    await expect
      .poll(async () => (await band.innerText()).replace(/\D/g, ''), { timeout: 8_000 })
      .toBe(String(state.stats.decisions_logged));
  });

  test('the rail diagram shows a request being stopped at the gate', async ({ page }) => {
    const diagram = page.getByRole('img', { name: /travels from the shopping agent/i });
    await diagram.scrollIntoViewIfNeeded();
    await expect(diagram).toBeVisible();

    // It alternates between the two endings; both must be reachable, because
    // the contrast between them is the entire argument.
    // textContent, not innerText: an <svg> is not an HTMLElement.
    await expect
      .poll(async () => (await diagram.textContent()) ?? '', { timeout: 12_000 })
      .toMatch(/0 calls to Razorpay/i);
    await expect
      .poll(async () => (await diagram.textContent()) ?? '', { timeout: 12_000 })
      .toMatch(/order created/i);
  });

  test('every section renders - none stranded invisible by the scroll reveal', async ({ page }) => {
    const headings = [
      /a prompt is guidance/i,
      /the model never touches razorpay/i,
      /three controls decide whether money moves/i,
      /three rules break at once/i,
      /what this deliberately is not/i,
    ];
    for (const heading of headings) {
      const node = page.getByRole('heading', { name: heading });
      await node.scrollIntoViewIfNeeded();
      await expect(node).toBeVisible();
    }
  });

  test('the refusal sequence shows all three codes and lands the punchline', async ({ page }) => {
    // This is the story the page is selling; if it regresses the page is lying.
    await expect(page.getByText('CATEGORY_DENIED')).toBeVisible();
    await expect(page.getByText('PER_TRANSACTION_CAP_EXCEEDED')).toBeVisible();
    await expect(page.getByText('MONTHLY_CAP_EXCEEDED')).toBeVisible();

    // The single most important fact on the page. It used to be 11px grey text.
    await expect(page.getByText(/^0 calls to Razorpay$/)).toBeVisible();
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
