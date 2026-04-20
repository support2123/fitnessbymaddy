# FitnessByMaddy — Automation Platform

## Stack
- **Frontend**: Vanilla HTML/CSS/JS — no frameworks
- **Backend**: Vercel Serverless Functions (Node.js, /api/*)
- **Database**: Supabase (Postgres + Storage + Auth)
- **WhatsApp**: AiSensy API (fallback: Meta Cloud API)
- **Email**: Resend (from support@fitnessbymaddy.com)
- **Payments**: Exly (webhook on purchase)
- **AI**: Claude API for program generation

## Brand
- Colors: --gold #B8965A, --charcoal #2C2C2C, --cream #FAF8F4, --sand #F0EAE0
- Fonts: Bebas Neue (headings), DM Sans (body)
- Tone: Warm + expert, Hinglish for IN market, English for others
- Never bro-sciency, never over-promise

## Env Vars (Vercel)
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET, MADDY_PHONE

## Rules
- No frameworks, vanilla JS only
- PII: mask phone numbers in logs as +91XXX...374
- Rate limit: max 1 outbound per lead per 2 hrs
- Opt-out on "STOP"/"unsubscribe" — never message again
- Never auto-send programs without audit trail in programs table
- Halt + flag if Claude returns risky content
