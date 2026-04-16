# FitnessByMaddy — Automation Pipeline

End-to-end autonomous WhatsApp coaching funnel. From first inbound DM to
weekly AI-generated programs, Maddy only steps in on human-only decisions.

## Architecture

```
  WhatsApp ───▶ AiSensy/Meta ───▶ /api/whatsapp-webhook ─┐
                                                         ▼
     Site form ─▶ /api/lead-intake            ┌─── Supabase (Postgres + Storage)
     Site form ─▶ /api/checkin-submit  ◀──────┤
     Exly      ─▶ /api/exly-webhook           │
                                              ▼
     Vercel Cron ─▶ /api/cron/weekly-checkin
     Vercel Cron ─▶ /api/cron/checkin-nudge
     Vercel Cron ─▶ /api/cron/nudge-dropped
                                              │
                                              ▼
                        /api/generate-program ─▶ Claude ─▶ PDFKit ─▶ Storage ─▶ WhatsApp
```

## Flows

### A · New lead
1. Inbound WhatsApp → `whatsapp-webhook` upserts `leads`.
2. Welcome template `welcome_v1` (Hinglish for +91, English elsewhere).
3. 2 h silent → `nudge_trial` with `$20` trial link.
4. 24 h silent → `status = dropped`, silent drop.

### B · Qualification
Regex-based keyword routing in `utils.js#classifyProgram` → program slug →
`checkout_link` template (Exly URL + intake form URL).

### C · Conversion
Exly posts to `/api/exly-webhook` → lead promoted to `clients`, Storage
folder seeded, `onboard_{program}` template sent, Week-1 checkin row
pre-created. 12-week clients trigger immediate Week-1 program generation.

### D · Weekly check-in (every Sun 03:30 UTC / 09:00 IST)
1. Ensure a row in `checkins` for each active client's current week.
2. Send `checkin_ready` template with signed form link.
3. `checkin-nudge` cron sends reminders at +24 h, +48 h, escalates at +72 h.

### E · Weekly program (12-week clients only)
1. `/api/generate-program` called from cron or after check-in submission.
2. Reads last 2 check-ins + intake.
3. Claude returns strict JSON plan → safety filter in `claude.js`.
4. PDF rendered with PDFKit, uploaded to `/clients/{id}/week_{n}.pdf`.
5. Signed 30-day URL → `program_ready` template.
6. Audit row written to `programs` BEFORE send.

## Escalation triggers
All of these short-circuit auto-replies and open an `escalations` row
(+ WhatsApp ping to Maddy):
- Injury / pregnancy / medication / medical condition keywords
- Disordered-eating signals
- `refund`, `lawyer`, `complaint`, `didn't work`, `side effect`
- 2 consecutive missed check-ins
- Claude output safety filter trip
- PDF render or delivery failure

## Deployment checklist

1. **Supabase**
   - Create project, run `supabase/migrations/0001_init.sql` in SQL editor.
   - Create Storage bucket `clients`.
   - Add a Maddy user under Authentication for the admin dashboard.

2. **Vercel**
   - Import this repo, set the env vars from `.env.example`.
   - `CRON_SECRET` auto-provided by Vercel; crons wired in `vercel.json`.
   - Build command: none (static) · Output: `.`

3. **AiSensy**
   - Register every `TEMPLATES[...]` entry (`welcome_v1`, `checkout_link`,
     `onboard_*`, `checkin_ready`, `checkin_nudge`, `program_ready`,
     `nudge_trial`, `reengage_7d`) with Meta.
   - Set the webhook URL to `https://fitnessbymaddy.com/api/whatsapp-webhook`
     and share the secret via `AISENSY_WEBHOOK_SECRET`.

4. **Exly**
   - Set purchase webhook → `https://fitnessbymaddy.com/api/exly-webhook`
   - Shared secret via header `x-exly-secret` matching `EXLY_WEBHOOK_SECRET`.

5. **Admin dashboard**
   - Copy `admin/config.example.js` → `admin/config.js` and fill
     `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
   - Log in with the Maddy Supabase user.

## Testing before go-live

Use a dummy phone number (e.g. your own) and walk the full funnel:

1. Send "fat loss trial" → expect welcome + checkout link.
2. Complete Exly purchase (sandbox) → expect onboarding template.
3. Submit `/intake` form → expect Supabase client row updated with intake_json.
4. Trigger `/api/cron/weekly-checkin` manually → expect checkin link.
5. Submit `/checkin` form → for 12-week plan, expect a program PDF within ~60 s.
6. Send "refund" → expect silence on the user side and a ping to Maddy.
