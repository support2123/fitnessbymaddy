# CLAUDE.md — FitnessByMaddy automation

Operating rules for any Claude agent working in this repo.

## Stack (locked)
- Frontend: Vanilla HTML/CSS/JS. No frameworks, no bundlers.
- Fonts: Bebas Neue (headers), DM Sans (body), Cormorant Garamond (accents).
- Palette: see `css/style.css` `:root` — cream/sand/gold/charcoal only.
- Backend: Vercel serverless functions under `/api/**`, Node 20.
- Data: Supabase (Postgres + Storage). See `sql/schema.sql`.
- WhatsApp: AiSensy primary, Meta Cloud API fallback. See `lib/aisensy.js`.
- AI: Claude via `@anthropic-ai/sdk`, model `claude-opus-4-7`.
- PDF: `pdfkit`. See `lib/pdf.js`.
- Email: Resend.

## Brand rules
- Language: Hinglish for IN numbers (`+91`), English for UAE/UK/GLOBAL.
  Detection lives in `lib/utils.js::detectMarket`.
- Tone: warm + expert. Never bro-sciency, never over-promise timelines.
- All outbound templates must be pre-approved in AiSensy/Meta.

## Rate / safety
- Max 1 outbound per lead per 2 hours (`lib/rate-limit.js`).
- Opt-out keywords (`stop`, `unsubscribe`) → set `status=dropped`, never message.
- Never log full phone numbers; mask via `maskPhone`.
- Program generator must write an audit row in `programs` before any
  WhatsApp delivery. Halt on risky output — see `lib/claude.js::validateSafety`.

## Human escalations (route to Maddy on WhatsApp)
Triggered on: injury, pregnancy, medication, pain/dizziness,
disordered-eating signals, refund/complaint/lawyer, "didn't work",
"side effect". See `lib/utils.js::escalationReason`.

Also escalate:
- Refund requests (hit the same regex).
- Payment failure for active client (Exly webhook retries or status `refunded`).
- 2 consecutive missed check-ins (cron can flag; left as v2).

## Secrets
All secrets via Vercel env vars (see `.env.example`). Never commit real keys.

## Deploy
```
npx vercel --prod --yes
```
Schedules are declared in `vercel.json` (cron).

## Touch-points
- `/intake`    → `intake.html` → `POST /api/lead-intake`
- `/checkin`   → `checkin.html` → `POST /api/checkin-submit`
- `/reschedule`→ `reschedule.html` → `POST /api/lead-intake` (notes flag)
- `/admin`     → `admin.html` (Supabase Auth) → `GET /api/admin`
- Inbound WA → `POST /api/whatsapp-webhook`
- Exly purchase → `POST /api/exly-webhook`
- Internal program gen → `POST /api/generate-program` (requires `x-internal-secret`)

## Code style
- No comments for the obvious. Only annotate non-obvious invariants.
- No frameworks. Vanilla JS inside forms; ES modules in `api/`/`lib/`.
- Prefer small helpers in `lib/`; don't abstract prematurely.
