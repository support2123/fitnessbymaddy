# Fitness by Maddy — Codebase Rules

## Stack
- Frontend: Vanilla HTML/CSS/JS (no frameworks)
- Backend: Vercel Serverless Functions (Node.js, /api/)
- Database: Supabase (Postgres + Storage)
- WhatsApp: AiSensy API
- Email: Resend
- AI: Claude API (Anthropic SDK)

## Brand
- Fonts: Cormorant Garamond (headings), DM Sans (body), Bebas Neue (PDF headers)
- Colors: cream #FAF8F4, gold #B8965A, charcoal #2C2C2C, sand #F0EAE0
- Tone: Warm + expert. Never bro-sciency. Never over-promise.

## Conventions
- No frameworks — vanilla JS only
- All API routes in /api/ as Vercel serverless functions
- Shared code in /lib/
- Environment variables via Vercel (never hardcode secrets)
- PII masking: never log full phone numbers in errors
- All WhatsApp messages logged to `messages` table
