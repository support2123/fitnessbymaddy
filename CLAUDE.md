# CLAUDE.md — Engineering rules for FitnessByMaddy

Short, sharp rules. Follow them without asking.

## Stack (locked)
- **Static site + forms:** Vanilla HTML / CSS / JS. No frameworks, no bundlers.
- **Serverless:** Vercel `/api/*`, Node 20, ES modules.
- **DB / storage / auth:** Supabase.
- **WhatsApp:** AiSensy (primary) → Meta Cloud API (fallback).
- **Email:** Resend, from `support@fitnessbymaddy.com`.
- **Scheduler:** Vercel Cron (`vercel.json` → `crons[]`).

## Brand
- Palette tokens live in `css/style.css` (`:root`). Use those vars, never hex.
- Headers: **Cormorant Garamond** (serif, italic for emphasis).
- Body: **DM Sans**.
- Tone in copy: warm + expert. Hinglish for `+91`; English for UAE / UK / GLOBAL.
- Never bro-sciency. Never over-promise. Never hype numbers.

## Safety rails
- Every inbound message + outbound send hits `public.messages`.
- Escalation triggers (`api/_lib/utils.js` → `detectEscalation`) short-circuit
  all autoreplies and ping Maddy.
- Claude output runs through `runSafetyFilter` in `api/_lib/claude.js` before
  PDF render. Flagged plans never go out.
- Rate limit: 1 outbound per lead per 2 h. Active clients bypass.
- "STOP" / "unsubscribe" → `status=dropped`, `opted_out=true`, end.

## PII
- Mask phones in logs via `maskPhone()`. Never log full E.164.
- Never ship the service role key to the browser. `/admin/config.js` uses
  the anon key only; RLS policies enforce read access.

## Code style
- Small files. No premature abstraction. Comments explain *why*, not *what*.
- No new dependencies without a clear win (we use only: supabase-js, pdfkit,
  resend).
- When a new flow is added, append the template to `TEMPLATES` in
  `api/_lib/whatsapp.js` AND register it in AiSensy.

## Commit / deploy
- Commit after each flow. Deploy:
  `cd /Users/mandeepjakhar/Desktop/fitnessbymaddy-v2 && npx vercel --prod --yes`
- Secrets go in Vercel env vars. Keys listed in `.env.example`.
