# FitnessByMaddy — Automation Pipeline

End-to-end: lead → qualify → checkout → onboard → weekly check-in → weekly
custom program (12wk only) → escalate when human judgment is needed.

## Architecture

```
WhatsApp (AiSensy / Meta) ──► /api/whatsapp-webhook ──► leads
   │                                                       │
   │                                                       ▼
   ▼                                          /api/lead-intake
Exly purchase ──► /api/exly-webhook ──► clients ─────► onboarding WA
                                                       │
                                                       ▼
        cron Sun 09:00 IST ──► /api/cron/weekly-checkin ──► WA form link
                                                       │
                                                       ▼
                                          /api/checkin-submit
                                                       │  (12wk only)
                                                       ▼
                                          /api/generate-program
                                          (Claude → safety → PDF → WA)

cron daily ──► /api/cron/nudge-dropped       (re-engage 7-day dormant)
cron 6h    ──► /api/cron/checkin-nudges      (24h / 48h reminders)
```

## Endpoints

| Path                        | Method | Auth                       |
|-----------------------------|--------|----------------------------|
| `/api/whatsapp-webhook`     | GET/POST | Meta verify-token / open  |
| `/api/lead-intake`          | POST   | open (rate-limited form)   |
| `/api/checkin-submit`       | POST   | open (URL has client token)|
| `/api/reschedule-submit`    | POST   | open                       |
| `/api/exly-webhook`         | POST   | `x-exly-signature`         |
| `/api/cron/weekly-checkin`  | GET/POST | `x-cron-secret` (Vercel)  |
| `/api/cron/checkin-nudges`  | GET/POST | `x-cron-secret`           |
| `/api/cron/nudge-dropped`   | GET/POST | `x-cron-secret`           |
| `/api/generate-program`     | POST   | `x-cron-secret`            |
| `/api/send-whatsapp`        | POST   | `x-cron-secret`            |
| `/api/admin-stats`          | GET    | Supabase access token      |

## One-time setup

1. **Supabase**
   - Create project. Copy URL + anon key + service-role key.
   - Run `supabase/migrations/0001_init.sql` (SQL editor or `psql`).
   - Create a public storage bucket called `clients`
     (Storage → New bucket → name=`clients`, public).
   - Insert each admin email into `admin_emails`:
     ```sql
     insert into admin_emails(email) values ('maddy@fitnessbymaddy.com');
     ```

2. **Vercel env vars** — copy from `.env.example`. All required:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`,
   `AISENSY_API_KEY`, `CLAUDE_API_KEY`, `EXLY_WEBHOOK_SECRET`,
   `CRON_SECRET`, `MADDY_WHATSAPP`, `PUBLIC_SITE_URL`,
   `ADMIN_ALLOWED_EMAILS`.

3. **AiSensy**
   - Pre-approve every template name in `api/_lib/templates.js`
     (`welcome_v1`, `nudge_trial`, `qualify_*`, `onboard_*`,
     `checkin_request`, `checkin_nudge`, `weekly_program`,
     `reengage_dropped`).
   - Webhook URL → `https://fitnessbymaddy.com/api/whatsapp-webhook`.

4. **Exly**
   - Add a webhook on `order.completed` → same domain
     `/api/exly-webhook`, secret matching `EXLY_WEBHOOK_SECRET`.

5. **Admin dashboard**
   - Copy `admin/env.example.js` → `admin/env.js`, fill Supabase URL +
     anon key. (File is gitignored.)
   - Visit `https://fitnessbymaddy.com/admin`, sign in via magic link.

## Cron schedule

Defined in `vercel.json`. Times are UTC.

| Job                            | When (UTC)        | Local equivalent     |
|--------------------------------|-------------------|----------------------|
| `/api/cron/weekly-checkin`     | `30 3 * * 0`      | Sunday 09:00 IST     |
| `/api/cron/checkin-nudges`     | `0 */6 * * *`     | every 6 hours        |
| `/api/cron/nudge-dropped`      | `0 5 * * *`       | daily 10:30 IST      |

## Safety rails

- `api/_lib/safety.js` blocks Claude outputs with sub-floor calorie
  targets, banned substances, or self-flagged content. Blocked plans
  are stored with `flagged_for_review = true` and Maddy is notified.
- `api/_lib/escalation.js` keyword-routes risky inbound messages
  (refund / pain / pregnancy / medication / etc.) and pings Maddy.
- All outbound is rate-limited to 1 message per phone per 2 h, except
  active clients and `bypassRateLimit: true` calls (onboarding,
  weekly drops, escalation acks).
- Phone numbers are masked in escalation pings and admin tables.
- `STOP` / `unsubscribe` permanently moves a lead to `dropped`.

## Local dev

```sh
npm i
cp .env.example .env.local && vim .env.local
npx vercel dev
```

## Deploy

```sh
npx vercel --prod --yes
```
