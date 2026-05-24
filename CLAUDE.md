# FitnessByMaddy Automation

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js)
- Database: Supabase (Postgres)
- WhatsApp: AiSensy API
- AI: Claude API for program generation
- Email: Resend

## Brand
- Fonts: Cormorant Garamond (headings), DM Sans (body)
- Colors: --cream #FAF8F4, --gold #B8965A, --charcoal #2C2C2C
- Tone: Warm + expert, default Hinglish for IN market

## Project Structure
- `/api/` — Vercel serverless functions
- `/api/lib/` — Shared utilities (supabase, whatsapp, escalation)
- `/api/cron/` — Scheduled jobs
- `/api/admin/` — Admin API
- `/admin/` — Dashboard UI
- `/db/` — Database migrations
- `*.html` — Public pages and forms

## Rules
- Never hardcode secrets
- Never log full phone numbers
- Max 1 outbound message per 2hrs for leads
- Always audit trail messages in DB
- Escalate medical/legal keywords to Maddy
- Safety-check generated programs before sending

## Deploy
```
npx vercel --prod --yes
```

## Environment Variables Required
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET, INTERNAL_API_SECRET, CRON_SECRET
