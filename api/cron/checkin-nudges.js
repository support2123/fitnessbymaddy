// Cron: every 6 hours.
// Nudge clients who haven't submitted their current-week check-in yet
// at +24h and +48h after the request was sent. After 2 misses → escalate.
import { db } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { template } from '../_lib/templates.js';
import { marketForPhone } from '../_lib/market.js';
import { checkinUrl } from '../_lib/checkout.js';
import { escalate } from '../_lib/escalation.js';
import { requireCronAuth } from '../_lib/util.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req)) return res.status(401).json({ ok: false });

  const supa = db();
  const { data: clients } = await supa
    .from('clients').select('*').eq('status', 'active');

  let nudged = 0, escalated = 0;
  for (const c of clients || []) {
    const weekNo = Math.floor((Date.now() - new Date(c.program_started_at).getTime()) / 86400_000 / 7);
    if (weekNo < 1) continue;

    const { data: checkin } = await supa
      .from('checkins').select('id').eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();
    if (checkin) continue;

    // Find the most recent checkin_request for this client + week.
    const { data: msgs } = await supa
      .from('messages').select('sent_at,template_name,meta')
      .eq('phone', c.phone).eq('direction', 'out')
      .order('sent_at', { ascending: false }).limit(20);
    const requestMsg = (msgs || []).find(
      (m) => m.template_name === 'checkin_request' && m.meta?.week_no === weekNo
    );
    if (!requestMsg) continue;

    const ageH = (Date.now() - new Date(requestMsg.sent_at).getTime()) / 3600_000;
    const nudgeMsgs = (msgs || []).filter(
      (m) => m.template_name === 'checkin_nudge' && m.meta?.week_no === weekNo
    );

    let shouldNudge = false;
    if (ageH >= 48 && nudgeMsgs.length < 2) shouldNudge = true;
    else if (ageH >= 24 && nudgeMsgs.length < 1) shouldNudge = true;

    if (shouldNudge) {
      const market = marketForPhone(c.phone);
      const t = template('checkin_nudge', market, {
        week_no: String(weekNo),
        form_url: checkinUrl(c.id, weekNo),
      });
      await sendWhatsApp({
        phone: c.phone, body: t.body, templateName: t.name, bypassRateLimit: true,
        meta: { kind: 'checkin_nudge', week_no: weekNo },
      });
      nudged++;
    }

    // 2 consecutive missed weeks → escalate.
    const { data: prevCheckin } = await supa
      .from('checkins').select('id')
      .eq('client_id', c.id).eq('week_no', weekNo - 1).maybeSingle();
    if (weekNo > 1 && !prevCheckin && ageH >= 72) {
      await escalate({
        phone: c.phone, clientId: c.id,
        trigger: 'two_missed_checkins',
        context: `Weeks ${weekNo - 1} and ${weekNo} both missing.`,
      });
      escalated++;
    }
  }

  return res.status(200).json({ ok: true, nudged, escalated });
}
