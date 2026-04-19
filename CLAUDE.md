# FitnessByMaddy — Project Rules

## Stack
- Frontend: Vanilla HTML/CSS/JS — NO frameworks
- Backend: Vercel Serverless Functions (Node.js in /api/)
- Database: Supabase (Postgres + Storage + Auth)
- WhatsApp: AiSensy API
- Email: Resend
- PDF: PDFKit
- AI: Claude API (Anthropic SDK)

## Brand
- Colors: cream #FAF8F4, gold #B8965A, charcoal #2C2C2C, sand #F0EAE0
- Fonts: Cormorant Garamond (headings), DM Sans (body)
- PDF template: black/gold, Bebas Neue headers
- Tone: warm + expert, never bro-sciency

## Code Rules
- No frameworks (React, Vue, etc.) — vanilla JS only
- All API endpoints in /api/ as Vercel serverless functions
- Shared utils in /lib/
- Never hardcode secrets — use process.env
- Mask PII in logs: phone → +91XXX...374
- All WhatsApp sends go through /api/send-whatsapp (rate-limited)

## Environment Variables (Vercel)
AISENSY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
CLAUDE_API_KEY, RESEND_API_KEY, EXLY_WEBHOOK_SECRET,
MADDY_PHONE (for escalation alerts)
