# FitnessByMaddy — Automation Pipeline

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js, CommonJS)
- Database: Supabase (Postgres + Storage + Auth)
- WhatsApp: AiSensy API / Meta Cloud API fallback
- Email: Resend (support@fitnessbymaddy.com)
- Payments: Exly (webhook on purchase)
- AI: Claude API for program generation
- PDF: PDFKit

## Brand
- Fonts: Cormorant Garamond (display), DM Sans (body)
- Colors: Gold #B8965A, Charcoal #2C2C2C, Cream #FAF8F4, Sand #F0EAE0
- Tone: Warm + expert, Hinglish for IN market, English for others

## Environment Variables (Vercel)
- SUPABASE_URL, SUPABASE_SERVICE_KEY
- AISENSY_API_KEY
- CLAUDE_API_KEY (Anthropic)
- RESEND_API_KEY
- EXLY_WEBHOOK_SECRET
- WA_VERIFY_TOKEN
- MADDY_PHONE (+917082478374)
- CRON_SECRET

## Conventions
- No frameworks. Vanilla JS only.
- Mobile-first forms (390px base)
- PII: mask phone numbers in logs as +91XXX...374
- Rate limit: max 1 outbound WA per lead per 2 hrs
- All WhatsApp sends logged to `messages` table
- Programs never auto-sent without audit trail in `programs` table
