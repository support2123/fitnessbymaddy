# FitnessByMaddy — Codebase Rules

## Stack
- Static HTML/CSS/JS frontend (no frameworks)
- Vercel Serverless Functions for /api/* endpoints
- Supabase (Postgres + Storage)
- AiSensy / Meta Cloud API for WhatsApp
- Resend for email
- Claude API for program generation
- PDFKit for branded PDF rendering

## Brand
- Colors: cream (#FAF8F4), gold (#B8965A), charcoal (#2C2C2C)
- Fonts: Cormorant Garamond (headers), DM Sans (body)
- Tone: Warm + expert. Never bro-sciency. Never over-promise.
- Language: Hinglish for IN market, English for UAE/UK/GLOBAL

## Rules
- No frameworks — vanilla JS only
- All API keys in Vercel env vars, never hardcoded
- Never log full phone numbers — mask as +91XXX...374
- Max 1 outbound message per lead per 2 hours
- "STOP"/"unsubscribe" → drop lead, never message again
- Never auto-send programs without audit trail in programs table
- Flag risky Claude outputs (extreme cuts, banned substances) for Maddy review

## Env vars (Vercel)
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET,
MADDY_PHONE (for escalations)
