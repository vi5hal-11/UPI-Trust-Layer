/**
 * Authentication for the step-up approval gate.
 *
 * The whole argument of this project is that a human approval is the last real
 * control on an autonomous agent's spending. An unauthenticated approval
 * endpoint would make that control decorative: anyone who could reach the port
 * could approve whatever the agent asked for.
 *
 * The split is deliberate:
 *   READS  (GET /api/state)          - public. Anyone may watch the gatekeeper
 *                                      work; that is the demonstration.
 *   WRITES (approve / deny a step-up) - authenticated. Only the mandate holder
 *                                      may release money.
 *
 * The mechanism is a shared secret exchanged for an HMAC-signed, httpOnly
 * cookie. No session store, no new dependency, and the secret itself never
 * reaches JavaScript in the browser. This is not an identity system - there is
 * one mandate and one holder - and the README says so rather than implying
 * more than it does.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const COOKIE = 'uatl_session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Constant-time compare that cannot leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn a comparison so timing does not reveal the length mismatch.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function sign(payload: string): string {
  return createHmac('sha256', env.approvalSecret).update(payload).digest('hex');
}

/** `<expiry>.<hmac>` - stateless, so restarting the server does not log you out. */
export function issueSession(): { value: string; maxAge: number } {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${expiresAt}.${randomBytes(8).toString('hex')}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: TTL_MS };
}

export function isValidSession(raw: string | undefined): boolean {
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 3) return false;

  const [expiresAt, nonce, mac] = parts as [string, string, string];
  if (!safeEqual(mac, sign(`${expiresAt}.${nonce}`))) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Verifies the shared secret presented at sign-in. */
export function isCorrectSecret(candidate: unknown): boolean {
  return typeof candidate === 'string' && candidate.length > 0 && safeEqual(candidate, env.approvalSecret);
}

/** Reads our cookie without pulling in a cookie-parser dependency. */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function setSessionCookie(res: Response, session: { value: string; maxAge: number }): void {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(session.value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(session.maxAge / 1000)}`,
  ];
  // Secure would make the cookie unusable over plain http on localhost.
  if (env.isProduction) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Gate for anything that can release money. */
export function requireApproval(req: Request, res: Response, next: NextFunction): void {
  if (isValidSession(readSessionCookie(req))) {
    next();
    return;
  }
  res.status(401).json({
    error:
      'Approving or declining a purchase requires you to unlock approvals first. ' +
      'Enter the approval secret in the dashboard, or POST it to /api/session.',
  });
}
