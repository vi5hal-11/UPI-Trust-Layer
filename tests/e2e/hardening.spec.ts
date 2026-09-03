import { expect, test } from '@playwright/test';
import { DashboardPage } from './pages/DashboardPage';

/**
 * The production controls, asserted rather than described.
 *
 * These are the two things a payments reviewer checks first: can a stranger
 * release money, and does a retry charge twice.
 */

test.describe('the approval gate is real', () => {
  test('an unauthenticated caller cannot approve or decline', async ({ request }) => {
    // Any id will do: the gate must reject before it ever looks one up.
    const approve = await request.post('/api/stepup/evt_does_not_exist/approve');
    expect(approve.status()).toBe(401);
    expect((await approve.json()).error).toMatch(/unlock approvals/i);

    const deny = await request.post('/api/stepup/evt_does_not_exist/deny');
    expect(deny.status()).toBe(401);
  });

  test('reading the audit trail stays public', async ({ request }) => {
    // Being able to watch the gatekeeper work is the demonstration; only
    // releasing money is gated.
    const state = await request.get('/api/state');
    expect(state.ok()).toBeTruthy();
    expect((await state.json()).events).toBeDefined();
  });

  test('a wrong secret is refused and does not unlock anything', async ({ request }) => {
    const bad = await request.post('/api/session', { data: { secret: 'not-the-secret' } });
    expect(bad.status()).toBe(401);

    const session = await request.get('/api/session');
    expect((await session.json()).unlocked).toBe(false);
  });

  test('the correct secret unlocks, and locking again revokes it', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();

    await expect(page.getByRole('button', { name: /unlock approvals/i })).toBeVisible();

    await dash.unlockApprovals();

    // Deliberately page.request, not the standalone `request` fixture: the two
    // are separate cookie jars, and the session cookie lives on the page's
    // context. Asking the other one would report "locked" no matter what.
    expect((await (await page.request.get('/api/session')).json()).unlocked).toBe(true);
    await expect(page.getByRole('button', { name: /approvals unlocked/i })).toBeVisible();

    await page.request.delete('/api/session');
    expect((await (await page.request.get('/api/session')).json()).unlocked).toBe(false);
  });
});

test.describe('a retried purchase does not pay twice', () => {
  test('the same Idempotency-Key replays the original decision', async ({ request }) => {
    const key = `e2e-idem-${Date.now()}`;
    const body = {
      item: 'e2e idempotent kettle',
      amount_inr: 24_000,
      category: 'electronics', // blocked, so this test never consumes budget
    };

    const first = await request.post('/api/intent', {
      data: body,
      headers: { 'Idempotency-Key': key },
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = await first.json();
    expect(first.headers()['idempotent-replay']).toBeUndefined();

    const second = await request.post('/api/intent', {
      data: body,
      headers: { 'Idempotency-Key': key },
    });
    expect(second.ok()).toBeTruthy();
    expect(second.headers()['idempotent-replay']).toBe('true');

    const secondBody = await second.json();
    // Same event id means no second audit event and no second rail call.
    expect(secondBody.event.event_id).toBe(firstBody.event.event_id);
  });

  test('reusing a key with different details is refused, not silently answered', async ({
    request,
  }) => {
    const key = `e2e-idem-conflict-${Date.now()}`;

    const first = await request.post('/api/intent', {
      data: { item: 'e2e first item', amount_inr: 24_000, category: 'electronics' },
      headers: { 'Idempotency-Key': key },
    });
    expect(first.ok()).toBeTruthy();

    const conflicting = await request.post('/api/intent', {
      data: { item: 'e2e DIFFERENT item', amount_inr: 24_000, category: 'electronics' },
      headers: { 'Idempotency-Key': key },
    });
    expect(conflicting.status()).toBe(409);
    expect((await conflicting.json()).error).toMatch(/already used for a different purchase/i);
  });

  test('without a key, two identical requests are two real decisions', async ({ request }) => {
    // Idempotency is opt-in. Without a key the service must not silently
    // de-duplicate: two deliberate attempts are two events.
    const body = { item: 'e2e no key', amount_inr: 24_000, category: 'electronics' };
    const a = await request.post('/api/intent', { data: body });
    const b = await request.post('/api/intent', { data: body });
    expect((await a.json()).event.event_id).not.toBe((await b.json()).event.event_id);
  });
});

test.describe('operational endpoints', () => {
  test('health and readiness answer', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.ok()).toBeTruthy();
    expect((await health.json()).status).toBe('ok');

    const ready = await request.get('/ready');
    expect(ready.ok()).toBeTruthy();
    expect((await ready.json()).status).toBe('ready');
  });

  test('the sign-in route is rate limited', async ({ request }) => {
    const key = `burst-${Date.now()}`;
    let sawLimit = false;
    // The limit is 10/min; a handful past that must start returning 429.
    for (let i = 0; i < 16; i += 1) {
      const res = await request.post('/api/session', { data: { secret: `${key}-${i}` } });
      if (res.status() === 429) {
        expect(res.headers()['retry-after']).toBeDefined();
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBeTruthy();
  });
});
