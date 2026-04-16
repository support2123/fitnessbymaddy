// Cron: daily — nudges active clients whose current-week check-in is overdue.
// +24h and +48h nudges based on the last `checkin_invite` send time.
// Escalates on 2 consecutive missed check-ins.

import { db } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { copyFor, detectMarket } from '../../lib/lang.js';
import { checkinUrl } from '../../lib/routing.js';
import { raiseEscalation } from '../../lib/escalation.js';
import { json, isCronRequest, requireAdmin } from '../../lib/http.js';
import { maskPhone } from '../../lib/pii.js';

export default async function handler(req, res) {
  if (!isCronRequest(req) && !requireAdmin(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }
  const sb = db();
  const { data: clients } = await sb
    .from('clients')
    .select('id, phone, name, program, program_started_at')
    .eq('status', 'active');

  const now = Date.now();
  let nudged = 0;
  let escalated = 0;

  for (const c of clients || []) {
    if (!c.program_started_at) continue;
    const startedMs = new Date(c.program_started_at).getTime();
    const week = Math.max(1, Math.ceil((now - startedMs) / (7 * 24 * 60 * 60 * 1000)));

    // Check if form submitted this week.
    const { data: checkin } = await sb.from('checkins')
      .select('id, form_submitted_at')
      .eq('client_id', c.id).eq('week_no', week).maybeSingle();
    if (checkin?.form_submitted_at) continue;

    // Find last invite message for this client.
    const { data: invites } = await sb.from('messages')
      .select('sent_at, template_name')
      .eq('phone', c.phone)
      .in('template_name', ['checkin_invite', 'checkin_nudge'])
      .order('sent_at', { ascending: false })
      .limit(1);
    const lastSent = invites?.[0] ? new Date(invites[0].sent_at).getTime() : 0;
    const hoursSince = (now - lastSent) / (60 * 60 * 1000);
    if (hoursSince < 22) continue;       // not yet +24h
    if (hoursSince > 72) continue;       // too stale; next weekly cron picks up

    const market = detectMarket(c.phone);
    const link = checkinUrl(c.id, week);
    const { ok } = await sendWhatsApp({
      phone: c.phone,
      body: copyFor('checkin_nudge', market, { week, link }),
      templateName: 'checkin_nudge',
      campaignName: `checkin_nudge_w${week}`,
      params: [String(week), link]
    });
    if (ok) nudged++;

    // 2 consecutive misses → escalate.
    if (week >= 2) {
      const { data: prev } = await sb.from('checkins')
        .select('form_submitted_at')
        .eq('client_id', c.id).eq('week_no', week - 1).maybeSingle();
      if (!prev?.form_submitted_at) {
        await raiseEscalation({
          phone: c.phone,
          client_id: c.id,
          reason: 'missed_checkins_2',
          context: `Weeks ${week - 1} and ${week} both missing`
        });
        escalated++;
      }
    }

    console.log(`[checkin-nudge] ${maskPhone(c.phone)} week ${week} nudged=${ok}`);
  }

  return json(res, 200, { ok: true, nudged, escalated });
}
