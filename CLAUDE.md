# FitnessByMaddy — Project Rules

## Stack
- Frontend: Vanilla HTML/CSS/JS — no frameworks
- Backend: Vercel Serverless Functions (Node.js 18+)
- Database: Supabase (Postgres + Storage)
- WhatsApp: AiSensy API
- Email: Resend
- Payments: Exly (webhook-based)

## Brand
- Colors: cream (#FAF8F4), gold (#B8965A), charcoal (#2C2C2C), sand (#F0EAE0)
- Fonts: Cormorant Garamond (headings), DM Sans (body)
- Tone: Warm + expert. Hinglish for IN market, English for UAE/UK/GLOBAL
- Never bro-sciency. Never over-promise.

## Conventions
- API routes in /api/*.js — export default handler(req, res)
- Shared libs in /lib/*.js — CommonJS (require)
- Static pages at root — vanilla HTML
- All secrets via process.env (Vercel env vars), never hardcoded
- PII masking in logs: phone as +91XXX...374
- Rate limit: max 1 outbound WhatsApp per lead per 2 hours

## Key env vars
SUPABASE_URL, SUPABASE_SERVICE_KEY, AISENSY_API_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET
