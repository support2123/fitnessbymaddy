# FitnessByMaddy - Automated Coaching Pipeline

## Project Structure
```
/                     → Static marketing pages (index, shred, custom, vip)
/intake.html          → Client onboarding form
/checkin.html         → Weekly check-in form
/reschedule.html      → Missed session rescheduler
/admin/               → Admin dashboard (Supabase-powered)
/api/                 → Vercel Serverless Functions
/api/_lib/            → Shared utilities
/api/cron/            → Scheduled jobs
/css/                 → Brand styles
/js/                  → Frontend scripts
```

## Tech Stack
- Frontend: Vanilla HTML/CSS/JS (NO frameworks)
- Backend: Vercel Serverless Functions (Node.js 18+)
- Database: Supabase (Postgres + Storage)
- WhatsApp: AiSensy API
- Email: Resend
- AI: Claude API (Anthropic)
- Domain: fitnessbymaddy.com (GoDaddy DNS)

## Brand Rules
- Colors: cream (#FAF8F4), gold (#B8965A), charcoal (#2C2C2C)
- Fonts: Cormorant Garamond (headers), DM Sans (body)
- Tone: Warm + expert. NEVER bro-sciency. Hinglish for IN market.
- Mobile-first design (390px base)

## Code Rules
- No npm packages in API functions (use fetch for HTTP calls)
- Exception: @supabase/supabase-js is allowed
- All API functions export default async handler(req, res)
- Always handle CORS (OPTIONS preflight)
- Never log full phone numbers — mask as +91XXX...374
- Store audit trail for all WhatsApp messages
- Rate limit: max 1 outbound per lead per 2hrs

## Environment Variables (Vercel)
- AISENSY_API_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- CLAUDE_API_KEY
- RESEND_API_KEY
- EXLY_WEBHOOK_SECRET
- MADDY_PHONE

## Deployment
```bash
npx vercel --prod --yes
```
