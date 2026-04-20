# Fitness by Maddy — Automation Pipeline

## Architecture
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **Backend**: Vercel Serverless Functions (`/api/*`)
- **Database**: Supabase (Postgres + Storage + Auth)
- **WhatsApp**: AiSensy API
- **AI**: Claude API for program generation
- **Email**: Resend
- **Payments**: Exly checkout

## Brand
- Colors: cream `#FAF8F4`, gold `#B8965A`, charcoal `#2C2C2C`
- Fonts: Cormorant Garamond (site display), Bebas Neue (form headers), DM Sans (body)
- Tone: Warm + expert. Hinglish for IN market, English for global.

## Environment Variables (Vercel)
```
SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
AISENSY_API_KEY
CLAUDE_API_KEY (ANTHROPIC_API_KEY)
RESEND_API_KEY
EXLY_WEBHOOK_SECRET
CRON_SECRET
```

## API Endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/whatsapp-webhook` | GET/POST | AiSensy incoming messages |
| `/api/lead-intake` | POST | Intake + reschedule form handler |
| `/api/checkin-submit` | POST | Weekly check-in handler |
| `/api/exly-webhook` | POST | Purchase confirmation |
| `/api/generate-program` | POST | Claude AI + PDF generation (internal) |
| `/api/send-whatsapp` | POST | Rate-limited WA sender (internal) |
| `/api/cron/weekly-checkin` | GET | Sunday 9am IST cron |
| `/api/cron/nudge-dropped` | GET | Daily re-engagement cron |

## Database Tables
`leads`, `clients`, `checkins`, `programs`, `messages`
Migration: `supabase/migration.sql`

## Local Dev
```bash
npm install
npx vercel dev
```

## Rules
- Never hardcode secrets
- Mask phone numbers in logs
- Rate limit: 1 outbound msg per lead per 2 hrs
- Safety check all AI-generated programs
- Escalate medical/safety flags to Maddy
