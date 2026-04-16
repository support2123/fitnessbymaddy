// GET /api/cron/weekly-checkin
// Runs Sun 03:30 UTC (= Sun 09:00 IST per vercel.json).
// For every active client whose week boundary just rolled over:
//   1. Ensure a checkins row exists for this week.
//   2. Send the check-in link template.
//   3. Mark form_sent_at so the nudge cron can track it.

import { supabase } from '../_lib/supabase.js';
import { sendTemplate } from '../_lib/whatsapp.js';
import {
  detectMarket, randomToken, json, assertCron,
} from '../_lib/utils.js';

export default async function handler(req, res) {
  if (!assertCron(req)) return json(res, 401, { error: 'unauthorized' });

  const { data: clients, error } = await supabase.from('clients')
    .select('*').eq('status', 'active');
  if (error) return json(res, 500, { error: error.message });

  const results = { sent: 0, skipped: 0, errors: 0 };
  const now = new Date();

  for (const c of clients || []) {
    try {
      const weekNo = weeksSince(c.program_started_at);
      if (weekNo < 1) { results.skipped++; continue; }
      if (c.program_ends_at && new Date(c.program_ends_at) < now) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', c.id);
        results.skipped++; continue;
      }

      // Ensure row.
      const { data: existing } = await supabase.from('checkins')
        .select('id, token, form_sent_at, form_submitted_at')
        .eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();

      let row = existing;
      if (!row) {
        const { data: ins } = await supabase.from('checkins').insert({
          client_id: c.id, week_no: weekNo, token: randomToken(),
        }).select().single();
        row = ins;
      }
      if (row.form_sent_at) { results.skipped++; continue; }

      const link = `${process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com'}/checkin?c=${c.id}&w=${weekNo}&t=${row.token}`;

      await sendTemplate({
        phone: c.phone,
        templateName: 'checkin_ready',
        market: detectMarket(c.phone),
        params: { week: weekNo, link },
        isClient: true, force: true,
      });
      await supabase.from('checkins').update({
        form_sent_at: new Date().toISOString(),
      }).eq('id', row.id);
      results.sent++;
    } catch (e) {
      console.error('[checkin-cron] client', c.id, e?.message);
      results.errors++;
    }
  }
  return json(res, 200, { ok: true, ...results });
}

function weeksSince(startIso) {
  if (!startIso) return 0;
  const diff = Date.now() - new Date(startIso).getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}
