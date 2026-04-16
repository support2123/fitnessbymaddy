// GET /api/cron/nudge-dropped
// Runs daily at 10:00 UTC. Handles:
//   A) 2-hour silent new leads → send "nudge_trial".
//   B) 24-hour silent new leads → mark status=dropped (no further msg).
//   C) 7-day-old dropped leads → one re-engagement ping, then leave alone.

import { supabase } from '../_lib/supabase.js';
import { sendTemplate } from '../_lib/whatsapp.js';
import { detectMarket, json, assertCron } from '../_lib/utils.js';

export default async function handler(req, res) {
  if (!assertCron(req)) return json(res, 401, { error: 'unauthorized' });

  const now = Date.now();
  const results = { trial_nudge: 0, dropped: 0, reengaged: 0 };

  // ── A + B: new leads that haven't been converted ──────────
  const { data: newLeads } = await supabase.from('leads')
    .select('*').eq('status', 'new').eq('opted_out', false);

  for (const l of newLeads || []) {
    const ageH = (now - new Date(l.last_msg_at || l.created_at).getTime()) / (60 * 60 * 1000);

    if (ageH >= 24) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', l.id);
      results.dropped++;
      continue;
    }
    if (ageH >= 2 && (l.nudge_count || 0) < 1) {
      const link = `${process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com'}/intake?lead=${l.id}&p=zoom_trial`;
      await sendTemplate({
        phone: l.phone,
        templateName: 'nudge_trial',
        market: detectMarket(l.phone) || l.market,
        params: { link },
        lastOutboundAt: l.last_outbound_at,
      });
      await supabase.from('leads').update({
        nudge_count: (l.nudge_count || 0) + 1,
        last_outbound_at: new Date().toISOString(),
      }).eq('id', l.id);
      results.trial_nudge++;
    }
  }

  // ── C: dropped leads, ~7 days old, one-shot re-engagement ──
  const { data: dropped } = await supabase.from('leads')
    .select('*').eq('status', 'dropped').eq('opted_out', false)
    .lt('nudge_count', 2); // dropped leads start at 1; reengage once more.

  for (const l of dropped || []) {
    const ageD = (now - new Date(l.created_at).getTime()) / (24 * 60 * 60 * 1000);
    if (ageD < 7 || ageD > 9) continue;   // 7-9 day window

    const link = `${process.env.PUBLIC_SITE_URL || 'https://fitnessbymaddy.com'}/intake?lead=${l.id}&p=zoom_trial`;
    await sendTemplate({
      phone: l.phone,
      templateName: 'reengage_7d',
      market: detectMarket(l.phone) || l.market,
      params: { link },
      lastOutboundAt: l.last_outbound_at,
      force: true, // bypass 2-hr rule — this is a single scheduled send
    });
    await supabase.from('leads').update({
      nudge_count: (l.nudge_count || 0) + 1,
      last_outbound_at: new Date().toISOString(),
    }).eq('id', l.id);
    results.reengaged++;
  }

  return json(res, 200, { ok: true, ...results });
}
