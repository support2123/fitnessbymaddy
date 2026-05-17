# FitnessByMaddy Automation Pipeline

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js)
- Database: Supabase (Postgres)
- WhatsApp: AiSensy API
- Program AI: Claude API (Anthropic)
- Email: Resend

## Brand
- Colors: cream (#FAF8F4), gold (#B8965A), charcoal (#2C2C2C)
- Fonts: Cormorant Garamond (headings), DM Sans (body)
- Tone: Warm + expert. Hinglish for IN market, English for others.

## Structure
- `/api/` - Serverless functions (Vercel)
- `/api/lib/` - Shared utilities (supabase, whatsapp, escalation)
- `/api/cron/` - Scheduled jobs
- `/sql/` - Database migrations
- Root HTML files - Static pages and forms

## Env Vars (Vercel)
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET, CRON_SECRET

## Rules
- Never log full phone numbers - use maskPhone()
- Rate limit: 1 outbound msg per lead per 2hrs
- Always audit trail messages in the messages table
- Flag unsafe programs (extreme calories, banned substances) for review
- Escalate on health/legal keywords immediately
