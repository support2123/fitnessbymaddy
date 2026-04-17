# FitnessByMaddy

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js, /api/*)
- Database: Supabase (Postgres + Storage)
- WhatsApp: AiSensy API (Meta Cloud API fallback)
- Email: Resend
- Payments: Exly (webhook-driven)

## Brand
- Colors: cream #FAF8F4, gold #B8965A, charcoal #2C2C2C, sand #F0EAE0
- Fonts: Bebas Neue (headers), DM Sans (body), Cormorant Garamond (existing pages)
- Tone: Warm + expert, Hinglish for IN market, English for others

## Env Vars (Vercel)
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET, CRON_SECRET

## Commands
- Dev: vercel dev
- Deploy: vercel --prod --yes
- No build step (static + serverless)
