# FitnessByMaddy — Autonomous Coaching Pipeline

WhatsApp-first lead → qualify → convert → onboard → weekly-program loop for
FitnessByMaddy. Vanilla static site + Vercel serverless + Supabase + AiSensy +
Claude.

## Architecture

```
WhatsApp ─▶ /api/whatsapp-webhook ─▶ Supabase (leads)
                                  └─▶ AiSensy (welcome / nudge / route)
                                  └─▶ Maddy (escalation)

Website form  ─▶ /api/lead-intake      ─▶ Supabase (leads + notes)
Exly purchase ─▶ /api/exly-webhook     ─▶ Supabase (clients) + WA + Resend + gen Week 1
Weekly form   ─▶ /api/checkin-submit   ─▶ Supabase (checkins) ─▶ gen next week
Cron Sun 9IST ─▶ /api/cron/weekly-checkin  (ask + nudge)
Cron daily    ─▶ /api/cron/nudge-dropped   (2h nudge, 24h drop, 7d re-engage)
Internal      ─▶ /api/generate-program (Claude → PDF → Supabase Storage → WA)
Admin         ─▶ /admin.html (Supabase Auth) ─▶ /api/admin
```

## One-time setup

1. **Supabase** — open the SQL editor and run `sql/schema.sql`. This creates
   the five tables and the private `clients` storage bucket.
2. **Env vars** — copy `.env.example` and populate in Vercel:
   - `AISENSY_API_KEY`, `AISENSY_CAMPAIGN_WELCOME`, `AISENSY_CAMPAIGN_NUDGE`, `AISENSY_WEBHOOK_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
   - `CLAUDE_API_KEY`
   - `RESEND_API_KEY`, `RESEND_FROM`
   - `EXLY_WEBHOOK_SECRET`
   - `BUSINESS_WA_NUMBER`, `MADDY_WA_NUMBER`, `SITE_URL`
   - `ADMIN_ALLOWED_EMAILS`
3. **Meta templates** (if using Meta Cloud API) — approve `welcome_v1`,
   `nudge_trial`, and `onboard_<program>` templates.
4. **Admin user** — create a Supabase Auth user with password and add its
   email to `ADMIN_ALLOWED_EMAILS`. Then in `admin.html` set
   `window.__SUPABASE_URL` and `window.__SUPABASE_ANON`.
5. **Deploy**:
   ```
   npx vercel --prod --yes
   ```
6. Point AiSensy webhook to `https://fitnessbymaddy.com/api/whatsapp-webhook`.
   Point Exly purchase webhook to `https://fitnessbymaddy.com/api/exly-webhook`.

## Local checks (no keys required)
```
node --check api/whatsapp-webhook.js
node --check api/lead-intake.js
node --check api/checkin-submit.js
node --check api/exly-webhook.js
node --check api/generate-program.js
node --check api/admin.js
node --check api/send-whatsapp.js
node --check api/cron/weekly-checkin.js
node --check api/cron/nudge-dropped.js
```

## Flows (pipeline-level)

### A. New lead
Inbound WA → insert `leads(new)` → template `welcome_v1` → Hinglish for `+91`,
English elsewhere.

### B. Lead qualification
Keyword router (`lib/router.js`) maps reply → program → checkout + intake link,
`leads.status=qualified`.

### C. Conversion
Exly → `clients(active)`, `leads.status=converted`, storage folder,
WhatsApp `onboard_<program>`, email via Resend, kick off Week 1 for 12wk.

### D. Weekly check-in
Sunday 09:00 IST → ask every active client → 24h/48h nudge if not submitted.
On submit → trigger next week's program generation.

### E. Weekly program generation (12wk only)
Last 2 check-ins + profile → Claude → JSON → validate safety → PDF →
Supabase Storage → signed URL → WhatsApp.

## Safety

- Calories < 1,400 or banned substances → halt + notify Maddy.
- Escalation keywords (injury, medical, pregnancy, refund…) → halt lead flow
  and ping Maddy with a masked summary.
- Opt-out is absolute.
- Phone numbers are masked in logs (`+91XXX...374`).

## Files

```
api/
  whatsapp-webhook.js     inbound WA (AiSensy + Meta)
  lead-intake.js          website intake form
  checkin-submit.js       weekly check-in form
  exly-webhook.js         purchase conversion
  send-whatsapp.js        internal ad-hoc sender
  generate-program.js     Claude → PDF → WA
  admin.js                dashboard data feed
  cron/
    weekly-checkin.js     Sun 09:00 IST
    nudge-dropped.js      daily 10:00 IST
lib/
  supabase.js  aisensy.js  claude.js  pdf.js
  router.js    rate-limit.js  utils.js
sql/schema.sql
intake.html  checkin.html  reschedule.html  admin.html
css/style.css css/forms.css
vercel.json  package.json  .env.example
```
