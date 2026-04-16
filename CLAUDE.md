# FitnessByMaddy — Engineering & Brand Guide

## Stack (locked)

| Layer | Choice |
|-------|--------|
| WhatsApp | AiSensy (primary), Meta Cloud API (fallback). Business number `+917082478374`. |
| Database / Storage / Auth | Supabase |
| Forms | Vanilla HTML on fitnessbymaddy.com |
| Backend | Vercel Serverless Functions (`/api/*`) |
| Scheduler | Vercel Cron |
| Email | Resend (`support@fitnessbymaddy.com`) |
| Domain / DNS | GoDaddy |
| Payments | Exly (checkout) |

## Brand

Established in `css/style.css`. Do not introduce new typefaces or color tokens.

**Colors**
- `--cream #FAF8F4` — primary background
- `--warm-white #FFFFFF`
- `--sand #F0EAE0`
- `--taupe #C8B89A`
- `--gold #B8965A` — primary accent
- `--gold-light #D4AF7A`
- `--charcoal #2C2C2C` — primary text / CTA
- `--mid-grey #6B6B6B`
- `--light-grey #E8E3DC`

**Typography**
- Headings: `Cormorant Garamond` (serif, 300/400/600, italic via `<em>`)
- Body / UI: `DM Sans` (300/400/500/600)
- Eyebrows: uppercase, letter-spacing 4px, gold
- Buttons: uppercase, letter-spacing 2px, 2px radius

**Voice**
- Warm + expert. Hinglish for IN, English for UAE/UK/GLOBAL. Never bro-sciency. Never over-promise.

## Rules

1. **No frameworks.** Vanilla JS on the frontend. Node built-ins + direct fetch on serverless; only add a dependency if it cannot be reasonably polyfilled.
2. **Brand tokens only** — reuse variables from `css/style.css`. No new palettes.
3. **Secrets in Vercel env only.** Never hardcode. Keys: `AISENSY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLAUDE_API_KEY`, `RESEND_API_KEY`, `EXLY_WEBHOOK_SECRET`, `ADMIN_TOKEN`, `MADDY_PHONE`.
4. **Rate limit:** max 1 outbound WhatsApp message per lead per 2 hours (clients excluded).
5. **Opt-out:** any `STOP` / `unsubscribe` / `opt out` → `leads.status=dropped`, never message again.
6. **PII:** never log full phone numbers. Use `maskPhone()` (`+91XXX...374`).
7. **Weekly programs:** always write to `programs` table before sending. Never send un-audited.
8. **Claude-generated plans:** pass through `isRiskyPlan()` gate; flag to Maddy on violation.
9. **Escalation:** any keyword match in `ESCALATION_KEYWORDS` → notify Maddy on WhatsApp; do not auto-reply further.
10. **Deploy:** `npx vercel --prod --yes` after each flow lands.

## Data model

See `supabase/schema.sql` for canonical DDL. Tables:
`leads`, `clients`, `checkins`, `programs`, `messages`.

## API surface (`/api`)

| Endpoint | Trigger | Purpose |
|---|---|---|
| `whatsapp-webhook` | AiSensy POST | Flow A + B (greet, qualify, route) |
| `lead-intake` | Form POST | Profile capture on intake form submit |
| `checkin-submit` | Form POST | Weekly check-in capture |
| `exly-webhook` | Exly POST (HMAC) | Flow C — convert to client |
| `cron/weekly-checkin` | Sun 09:00 IST | Send weekly check-in links |
| `cron/nudge-dropped` | Daily 10:00 IST | Re-engage dropped leads (7d rule) |
| `generate-program` | Internal / cron | Flow E — Claude → PDF → send |
| `send-whatsapp` | Internal | Rate-limited sender |
| `admin/stats` | GET (token) | Dashboard data feed |

## Forms

`intake.html`, `checkin.html`, `reschedule.html` — mobile-first (390px), brand-consistent, submit to `/api/*`.

## Deployment

- `vercel.json` defines the cron schedule + function routing.
- Cron jobs are configured for UTC; IST values listed above are already converted.
