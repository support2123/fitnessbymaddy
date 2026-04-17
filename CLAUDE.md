# FitnessByMaddy - Automation Pipeline

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **Backend**: Vercel Serverless Functions (Node.js, /api/*)
- **Database**: Supabase (Postgres + Storage)
- **WhatsApp**: AiSensy API (fallback: Meta Cloud API)
- **Email**: Resend (support@fitnessbymaddy.com)
- **Payments**: Exly (webhook-driven)

## Brand
- Colors: Gold (#B8965A), Charcoal (#2C2C2C), Cream (#FAF8F4)
- Fonts: Bebas Neue (headings), DM Sans (body)
- Tone: Warm, expert, never bro-sciency

## Rules
- No frameworks (React, Vue, etc.) — vanilla JS only
- Never hardcode secrets — use process.env
- Mask PII in logs (phone → +91XXX...374)
- All WhatsApp sends go through /api/send-whatsapp (rate-limited)
- Escalation triggers must always notify Maddy
- Weekly programs must have audit trail in `programs` table before sending

## Environment Variables
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET,
MADDY_PHONE (for escalation alerts)
