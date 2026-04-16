# Fitness by Maddy

Marketing site **plus** the autonomous WhatsApp-driven coaching pipeline.

```
lead (WhatsApp)  →  auto-greet  →  qualify  →  Exly checkout  →  onboard
                                                                    ↓
                                             weekly check-in  ←  weekly program PDF
                                                    ↓                 ↑
                                            Claude architect  →  Supabase + WA
```

---

## Stack

- **Static site**: vanilla HTML/CSS/JS (no framework). See `index.html`, `shred.html`, `custom.html`, `vip.html`.
- **Backend**: Vercel Serverless Functions in `api/*` (Node 20, ESM).
- **DB / storage / auth**: Supabase (`supabase/migrations/0001_init.sql`).
- **WhatsApp**: AiSensy (primary) → Meta Cloud API (fallback, `META_WA_*` env set).
- **AI**: Claude (`@anthropic-ai/sdk`, model `claude-opus-4-6`).
- **PDFs**: `pdf-lib` (pure JS, works in serverless).
- **Email**: Resend.
- **Scheduler**: Vercel Cron (see `vercel.json`).

---

## One-time setup

### 1. Supabase
1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor.
3. Create a **private** Storage bucket named `programs`.
4. Copy the project URL, the `anon` key and the `service_role` key.

### 2. AiSensy
Approve these WhatsApp templates (names must match `lib/templates.js`):
`welcome_v1`, `nudge_trial`, `qualify_link`, `onboard_6wk_gym`,
`onboard_6wk_home`, `onboard_12wk`, `onboard_pcos`, `onboard_40plus`,
`onboard_zoom_trial`, `onboard_zoom_pack`,
`checkin_request`, `checkin_nudge_24h`, `checkin_nudge_48h`,
`program_delivery`, `reengage_7day`.

Set the AiSensy webhook URL to: `https://<vercel-domain>/api/whatsapp-webhook`

### 3. Exly
Point the purchase webhook to: `https://<vercel-domain>/api/exly-webhook`
Set header: `x-exly-signature: <HMAC-SHA256 of body with EXLY_WEBHOOK_SECRET>`

### 4. Vercel env vars
Copy `.env.example` into Vercel project settings. Required:
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`,
`AISENSY_API_KEY`, `CLAUDE_API_KEY`, `RESEND_API_KEY`,
`EXLY_WEBHOOK_SECRET`, `MADDY_WA_NUMBER`, `ADMIN_EMAILS`, `CRON_SECRET`.

### 5. Deploy
```bash
npx vercel --prod --yes
```

---

## Endpoints (`/api/*`)

| Path | Purpose |
|---|---|
| `POST /api/whatsapp-webhook` | AiSensy / Meta inbound. Drives Flow A + Flow B. |
| `POST /api/lead-intake` | `/intake.html` form POSTs here. |
| `POST /api/checkin-submit` | `/checkin.html` form POSTs here. Triggers Flow E for 12-week. |
| `POST /api/exly-webhook` | Purchase → client. Signs with HMAC. |
| `POST /api/generate-program` | Claude + PDF + WhatsApp. Internal only. |
| `POST /api/send-whatsapp` | Rate-limited helper. Internal only. |
| `GET  /api/cron/weekly-checkin` | Sun 09:00 IST — schedules week's check-ins. |
| `GET  /api/cron/nudge-dropped` | Daily — 7-day reengage + 24/48h nudges. |
| `GET  /api/admin/stats` | Dashboard metrics (Bearer token from Supabase auth). |
| `GET  /api/admin/config` | Public anon keys for the dashboard. |

---

## Forms

| URL | File | Purpose |
|---|---|---|
| `/intake` | `intake.html` | New-client intake (age, goal, injuries, diet, schedule). |
| `/checkin` | `checkin.html` | Weekly check-in (stats + photos + mood). |
| `/reschedule` | `reschedule.html` | Missed-session rescheduler. |
| `/admin` | `admin.html` | Ops dashboard (Supabase magic-link auth + `ADMIN_EMAILS` allowlist). |

---

## Automation flows (see brief §3)

- **Flow A — New lead** → `api/whatsapp-webhook.js`
- **Flow B — Qualification** → `api/whatsapp-webhook.js` + `lib/routing.js`
- **Flow C — Conversion** → `api/exly-webhook.js`
- **Flow D — Weekly check-in** → `api/cron/weekly-checkin.js` + `api/checkin-submit.js`
- **Flow E — Program generation** → `api/generate-program.js` (Claude + pdf-lib + Supabase Storage)

---

## Critical rules enforced in code

- **Rate limit**: `lib/whatsapp.js` blocks >1 outbound / lead / 2h (active clients exempt).
- **Opt-out**: any `STOP` / `unsubscribe` / `band karo` reply marks the lead `dropped`, permanent silence.
- **PII masking**: `maskPhone()` in `lib/supabase.js`; used everywhere logs touch phone numbers.
- **Language**: auto-Hinglish for `+91`, English for UAE/UK/GLOBAL (see `lib/market.js`).
- **Program safety**: `lib/claude.js` deterministic `safetyCheck()` runs after the model:
  rejects kcal < 1500F / 1800M, banned substances, unrealistic promises, etc. Flagged
  programs are *never* auto-sent — they hit `escalations` for Maddy's review.
- **Human escalation**: `lib/escalation.js` detects injury / pregnancy / medication /
  complaint / refund / disordered-eating keywords → WhatsApps `MADDY_WA_NUMBER` + logs
  an `escalations` row.

---

## Operating the dashboard

1. Visit `https://fitnessbymaddy.com/admin`.
2. Enter an admin email (must be in `ADMIN_EMAILS`).
3. Click the magic link in your inbox.
4. Metrics show: new leads (today / week), conversion %, active clients by program,
   pending check-ins, programs generated, and open escalations.

---

## Local dev

```bash
npm install
npx vercel dev        # serves forms + /api/* locally
```

Use a local `.env` with your Supabase + AiSensy sandbox values.

---

## What to approve manually (human-only decisions)

Anything that lands in the `escalations` table. Specifically:

- Injuries, medical conditions, medication, pregnancy
- Chest pain / dizziness / disordered eating signals
- Refund / legal / "didn't work" messages
- 2 consecutive missed check-ins
- Any Claude-generated program flagged for review

Everything else runs autonomously.
