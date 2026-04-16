// GET /api/cron/checkin-nudge
// Runs twice daily (05:00 + 07:00 UTC per vercel.json).
// For any checkin row with form_sent_at but no form_submitted_at:
//   - +24 hr since sent and nudge_count = 0 → send reminder
//   - +48 hr since sent and nudge_count = 1 → send reminder
//   - +72 hr and still no submission → open escalation

import { supabase } from '../_lib/supabase.js';
import { sendTemplate } from '../_lib/whatsapp.js';
import { detectMarket, json, assertCron } from '../_lib/utils.js';
import { openEscalation } from '../_lib/escalation.js';

export default async function handler(req, res) {
  if (!assertCron(req)) return json(res, 401, { error: 'unauthorized' });

  const now = Date.now();
  const { data: pending } = await supabase.from('checkins')
    .select('*, clients(phone, name, status)')
    .is('form_submitted_at', null)
    .not('form_sent_at', 'is', null);

  const results = { nudged: 0, escalated: 0, skipped: 0 };

  for (const c of pending || []) {
    if (!c.clients || c.clients.status !== 'active') { results.skipped++; continue; }
    const ageH = (now - new Date(c.form_sent_at).getTime()) / (60 * 60 * 1000);

    if (ageH >= 72 && c.nudge_count >= 2) {
      await openEscalation({
        reason: 'missed_checkin_72h',
        phone: c.clients.phone, clientId: c.client_id,
        payload: { week: c.week_no },
      });
      await supabase.from('checkins').update({ nudge_count: 3 }).eq('id', c.id);
      results.escalated++; continue;
    }
    if (ageH >= 48 && c.nudge_count < 2) {
      await nudge(c);
      await supabase.from('checkins').update({ nudge_count: 2 }).eq('id', c.id);
      results.nudged++; continue;
    }
    if (ageH >= 24 && c.nudge_count < 1) {
      await nudge(c);
      await supabase.from('checkins').update({ nudge_count: 1 }).eq('id', c.id);
      results.nudged++; continue;
    }
    results.skipped++;
  }

  return json(res, 200, { ok: true, ...results });
}

async function nudge(c) {
  const link = `${process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com'}/checkin?c=${c.client_id}&w=${c.week_no}&t=${c.token}`;
  await sendTemplate({
    phone: c.clients.phone,
    templateName: 'checkin_nudge',
    market: detectMarket(c.clients.phone),
    params: { week: c.week_no, link },
    isClient: true, force: true,
  });
}
