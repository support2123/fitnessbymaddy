# FitnessByMaddy Automation Pipeline — Setup Guide

## 1. Supabase Setup

1. Create a Supabase project at https://supabase.com
2. Run `db/schema.sql` in the Supabase SQL Editor
3. Note your project URL and service role key

## 2. Vercel Environment Variables

Set these in Vercel Dashboard → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (for server-side) |
| `AISENSY_API_KEY` | AiSensy API key for WhatsApp templates |
| `CLAUDE_API_KEY` | Anthropic API key for program generation |
| `ANTHROPIC_API_KEY` | Same as above (SDK default) |
| `RESEND_API_KEY` | Resend API key for emails |
| `EXLY_WEBHOOK_SECRET` | Shared secret for Exly webhook verification |
| `INTERNAL_API_KEY` | Internal API auth key (generate a random UUID) |
| `CRON_SECRET` | Vercel cron secret for cron job auth |

## 3. AiSensy WhatsApp Templates

Register these templates in AiSensy:
- `welcome_v1` — New lead greeting
- `nudge_trial` — Trial nudge (2hr no-reply)
- `onboard_6wk_gym`, `onboard_12wk`, etc. — Program-specific welcome
- `weekly_checkin` — Weekly check-in form link
- `checkin_reminder` — Check-in nudge
- `weekly_program` — New program delivery

## 4. Webhook Configuration

### AiSensy Incoming Webhook
Point to: `https://fitnessbymaddy.com/api/whatsapp-webhook`

### Exly Purchase Webhook
Point to: `https://fitnessbymaddy.com/api/exly-webhook`
Set the `X-Webhook-Secret` header to match `EXLY_WEBHOOK_SECRET`

## 5. Admin Dashboard

1. Update `admin/config.js` with your Supabase anon key
2. Access at `https://fitnessbymaddy.com/admin`

## 6. Cron Jobs (auto-configured via vercel.json)

- Weekly check-in: Sundays 3:30 UTC (9:00 AM IST)
- Nudge/drop: Daily 6:00 UTC (11:30 AM IST)

## Architecture

```
Forms (intake, checkin, reschedule)
  → POST /api/* endpoints
    → Supabase (data)
    → AiSensy (WhatsApp)
    → Claude API (program generation)

WhatsApp → AiSensy webhook → /api/whatsapp-webhook
Exly purchase → /api/exly-webhook
Cron → /api/cron/weekly-checkin, /api/cron/nudge-dropped
```
