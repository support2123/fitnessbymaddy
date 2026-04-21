# FitnessByMaddy — Automation Pipeline

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **Backend**: Vercel Serverless Functions (`/api/*`)
- **Database**: Supabase (Postgres + Storage)
- **WhatsApp**: AiSensy API
- **Email**: Resend
- **Payments**: Exly (webhook-driven)
- **AI**: Claude API for program generation

## Brand
- Colors: charcoal `#2C2C2C`, gold `#B8965A`, cream `#FAF8F4`, sand `#F0EAE0`
- Fonts: Bebas Neue (form headers), DM Sans (body), Cormorant Garamond (site headers)
- Tone: Warm + expert. Hinglish for IN market, English for others.
- NEVER bro-sciency. NEVER over-promise.

## Env vars (Vercel)
- `AISENSY_API_KEY` — AiSensy WhatsApp API
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — Supabase service role key
- `CLAUDE_API_KEY` — Anthropic API key
- `RESEND_API_KEY` — Resend email API key
- `EXLY_WEBHOOK_SECRET` — Exly purchase webhook secret
- `MADDY_PHONE` — Maddy's WhatsApp for escalations

## Rules
- Max 1 outbound message per lead per 2 hrs (except opted-in clients)
- Never log full phone numbers — mask as +91XXX...374
- Never auto-send programs without audit trail in `programs` table
- Flag risky AI output (extreme calorie cuts, banned substances) for Maddy review
