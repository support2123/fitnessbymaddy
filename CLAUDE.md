# Fitness by Maddy — Automation Platform

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js, /api/*)
- Database: Supabase (Postgres + Storage)
- WhatsApp: AiSensy API
- Email: Resend
- Forms: Custom HTML, brand-consistent
- Scheduler: Vercel Cron

## Brand Rules
- Colors: --cream #FAF8F4, --gold #B8965A, --charcoal #2C2C2C, --sand #F0EAE0
- Fonts: Cormorant Garamond (headings), DM Sans (body)
- Tone: Warm + expert. Never bro-sciency. Never over-promise.
- Language: Hinglish for IN market (+91), English for all others

## Code Rules
- No frameworks — vanilla JS only
- All secrets in Vercel env vars, never hardcode
- Mask PII in logs: +91XXX...374
- All API routes in /api/ directory
- Forms mobile-first (390px base)
- Rate limit: max 1 outbound WhatsApp per lead per 2 hrs

## Key Paths
- /api/whatsapp-webhook — incoming WA messages
- /api/lead-intake — intake form handler
- /api/checkin-submit — weekly check-in handler
- /api/exly-webhook — purchase confirmation
- /api/cron/weekly-checkin — Sun 9am IST cron
- /api/cron/nudge-dropped — daily re-engagement
- /api/generate-program — Claude API + PDF
- /api/send-whatsapp — internal rate-limited sender
- /admin/ — dashboard (Supabase auth)
