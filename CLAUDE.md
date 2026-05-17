# FitnessByMaddy - Automation Pipeline

## Stack
- Static HTML + Vanilla JS (no frameworks)
- Vercel Serverless Functions (Node.js)
- Supabase (Postgres + Storage + Auth)
- AiSensy (WhatsApp Business API)
- Claude API (program generation)
- Resend (email)

## Brand
- Colors: cream (#FAF8F4), gold (#B8965A), charcoal (#2C2C2C), black (#1a1a1a)
- Fonts: Cormorant Garamond (site headers), Bebas Neue (form headers), DM Sans (body)
- Tone: Warm + expert. Hinglish for IN market, English for UAE/UK/GLOBAL

## Project Structure
```
/                    → Static site (index, shred, custom, vip)
/intake.html         → Client intake form
/checkin.html        → Weekly check-in form
/reschedule.html     → Session rescheduler
/admin/              → Ops dashboard (Supabase Auth)
/api/                → Vercel Serverless Functions
/api/lib/            → Shared modules (supabase, whatsapp, escalation)
/api/cron/           → Scheduled jobs
/sql/                → Database migrations
```

## Environment Variables (Vercel)
SUPABASE_URL, SUPABASE_SERVICE_KEY, AISENSY_API_KEY, CLAUDE_API_KEY,
RESEND_API_KEY, EXLY_WEBHOOK_SECRET, CRON_SECRET, INTERNAL_API_KEY

## Rules
- Never hardcode secrets
- Mask phone numbers in logs: +91XXX...374
- Rate limit: max 1 outbound WA per lead per 2hrs (clients exempt)
- Always store audit trail before sending WA messages
- Escalate on safety keywords (see api/lib/escalation.js)
- Never auto-send programs without programs table audit entry
