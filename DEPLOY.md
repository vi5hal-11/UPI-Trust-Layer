# Deploying

The service is one Node process that serves both the API and the built
dashboard. There is no separate front-end host, no database server, and no
container required.

```
build:  npm ci && npm run build     # installs, then builds dashboard/dist
start:  npm run serve               # starts WITHOUT rebuilding
health: GET /health
```

> Use `npm run serve`, not `npm start`. `start` has a `prestart` hook that runs
> the Vite build, so pairing it with a build command builds twice.

---

## The one constraint that decides everything: storage

The audit trail is a SQLite file. It is the product — a log that resets is not
an audit trail — so **where that file lives is the real deployment decision.**

| Platform | Persistent disk | Cost |
|---|---|---|
| Render, free instance | **No.** Free web services cannot attach a disk. | Free |
| Render, Starter instance | Yes — disks attach to paid services | ~$7/mo + $0.25/GB |
| Railway | Yes — volumes | Trial credit, then ~$5/mo |
| Fly.io | Yes — volumes | No free tier for new accounts since 2024 |

There is currently **no free option with a persistent disk.** So pick one of two
honest paths.

### Path A — free, ephemeral, self-seeding (recommended to start)

Deploy on a free instance with no disk and set `SEED_DEMO_ON_EMPTY=true`. On
every cold start, if the audit trail is empty, the service runs the four demo
scenarios **through the real gatekeeper** — real policy evaluation, real
Razorpay test-mode orders, events written by the same code path as any other
purchase. It does not insert rows.

- A visitor always arrives at a populated, truthful dashboard.
- Decisions made during a session persist until the instance restarts.
- Free instances also sleep when idle, so the first request after a quiet
  period takes ~30s to wake.

This is the right trade for a portfolio demo, and the README says so rather
than implying the log is permanent.

### Path B — paid, genuinely persistent

Attach a disk, mount it at `/data`, and set `AUDIT_DB_PATH=/data/audit.db`.
Leave `SEED_DEMO_ON_EMPTY` unset (or `false`) — seeding only fires on an empty
trail anyway, so it is harmless either way, but you want the real history kept.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | **yes** | Must begin `rzp_test_`. Startup refuses anything else, with no override. |
| `RAZORPAY_KEY_SECRET` | **yes** | |
| `APPROVAL_SECRET` | **yes** | Minimum 16 chars. Unlocks step-up approvals. Generate below. |
| `NODE_ENV` | yes | Set to `production` — this is what marks the session cookie `Secure`. |
| `SITE_URL` | yes | Your public origin, e.g. `https://uatl.onrender.com`. **Read at build time** for OG tags. |
| `AUDIT_DB_PATH` | Path B only | `/data/audit.db` when a disk is mounted. |
| `SEED_DEMO_ON_EMPTY` | Path A only | `true` on ephemeral storage. |
| `PORT` | no | Injected by the platform; the app reads it. |
| `AGENT_API_KEY` | no | Enables the LLM agent. Free key at `console.groq.com`. |
| `AGENT_BASE_URL` | no | Defaults to Groq. Any OpenAI-compatible endpoint. |

Generate the approval secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## Render, step by step

1. **New → Web Service**, connect the GitHub repo, pick `main`.
2. **Runtime** `Node`. **Region** Singapore is closest to Indian users.
3. **Build Command**
   ```
   npm ci && npm run build
   ```
4. **Start Command**
   ```
   npm run serve
   ```
5. **Health Check Path** — `/health`
6. **Environment** — add the variables from the table above. Set `SITE_URL` to
   your best guess of the final URL (Render shows it as you name the service);
   you will correct it in step 8.
7. **Create Web Service.** First build takes a few minutes — `better-sqlite3` is
   a native module, though prebuilt binaries exist for Linux so it should not
   compile from source.
8. **Fix `SITE_URL`.** Once Render shows the real URL, set `SITE_URL` to it
   exactly and trigger a manual redeploy. This matters: `SITE_URL` is baked into
   `index.html` at build time, and `og:image` cannot be a relative path — get it
   wrong and your link previews break silently.
9. **Path B only** — Settings → Disks → Add Disk, mount path `/data`, 1 GB. Then
   set `AUDIT_DB_PATH=/data/audit.db` and redeploy.

## Railway, step by step

1. **New Project → Deploy from GitHub repo.** Nixpacks detects Node.
2. **Settings → Build Command** `npm ci && npm run build`
3. **Settings → Start Command** `npm run serve`
4. **Variables** — as above.
5. **Settings → Networking → Generate Domain**, then set `SITE_URL` to it and
   redeploy.
6. **Volumes → New Volume**, mount at `/data`, then set
   `AUDIT_DB_PATH=/data/audit.db`.

---

## Verify the deploy

Run these against your live URL before sharing it.

```bash
BASE=https://your-app.onrender.com

curl -s $BASE/health                      # {"status":"ok",...}
curl -s $BASE/ready                       # {"status":"ready","mandate":"..."}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/            # 200, landing
curl -s -o /dev/null -w "%{http_code}\n" $BASE/dashboard   # 200, SPA fallback

# The audit trail is public...
curl -s $BASE/api/state | head -c 200

# ...but releasing money is not. This MUST be 401.
curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/api/stepup/x/approve

# A blocked purchase, end to end.
curl -s -X POST $BASE/api/intent -H 'content-type: application/json' \
  -d '{"item":"gaming keyboard","amount_inr":15000,"category":"electronics"}'
```

Then, by eye:

- [ ] `/` renders, and the rail diagram alternates between blocked and allowed
- [ ] `/dashboard` shows decisions, not "Nothing has been attempted yet"
- [ ] The mode badge reads **Razorpay test mode**
- [ ] Approve/Decline are disabled until you unlock with `APPROVAL_SECRET`
- [ ] Paste the URL into Slack or LinkedIn — the OG card renders. If it does
      not, `SITE_URL` was wrong at build time; fix and redeploy.
- [ ] The Razorpay dashboard (Test Mode → Orders) shows orders for the allowed
      purchases and **nothing** for the blocked one

---

## Rolling back

Both platforms redeploy a previous commit from their dashboard. Nothing here
requires a data migration, and the audit trail is append-only, so a rollback
cannot corrupt history — older code reading newer rows is the only risk, and the
schema has only ever gained columns.

---

## Things that will bite you

- **`npm start` on the host builds twice.** Use `npm run serve`.
- **`SITE_URL` is build-time, not runtime.** Changing it needs a rebuild, not a
  restart.
- **Free instances sleep.** The first hit after idle takes ~30s. If you are
  demoing live, open the URL a minute beforehand.
- **`npm run demo` cannot run while the server holds the database.** It deletes
  the file. Locally, stop the server first; on a host, do not run it at all —
  `SEED_DEMO_ON_EMPTY` covers that case.
- **Rotate your Razorpay keys** if they have ever been pasted into a chat, a
  screenshot, or a commit. Test keys move no money, but treat the habit as if
  they did.
