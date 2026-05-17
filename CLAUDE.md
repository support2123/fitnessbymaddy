# FitnessByMaddy - Automation Pipeline

## Stack
- Frontend: Static HTML (vanilla JS, no frameworks)
- Backend: Vercel Serverless Functions (Node.js, /api/*)
- Database: Supabase (Postgres + Storage + Auth)
- WhatsApp: AiSensy API
- Email: Resend
- Payments: Exly (webhook-based)
- AI: Claude API for program generation

## Brand
- Colors: Black (#0D0D0D), Gold (#B8965A), Cream (#FAF8F4)
- Fonts: Bebas Neue (headings), DM Sans (body)
- Tone: Warm + expert, Hinglish for IN market, English elsewhere

## Environment Variables (Vercel)
- AISENSY_API_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_KEY
- CLAUDE_API_KEY
- RESEND_API_KEY
- EXLY_WEBHOOK_SECRET
- INTERNAL_API_KEY
- CRON_SECRET

## Key Directories
- /api/ - Serverless functions
- /api/lib/ - Shared utilities (supabase, whatsapp, escalation)
- /api/cron/ - Scheduled jobs
- /admin/ - Dashboard (Supabase Auth protected)
- /supabase/ - Database schema

## Testing
- No test framework. Test endpoints via curl with dummy data.
- Never use real phone numbers in test messages.
