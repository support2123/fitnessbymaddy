// Cron: every Sunday 09:00 IST (= 03:30 UTC).
// For each active client: send week-N check-in form link.
import { db } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { template } from '../_lib/templates.js';
import { marketForPhone } from '../_lib/market.js';
import { checkinUrl } from '../_lib/checkout.js';
import { requireCronAuth } from '../_lib/util.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req)) return res.status(401).json({ ok: false });

  const supa = db();
  const { data: clients } = await supa
    .from('clients').select('*').eq('status', 'active');

  let sent = 0;
  for (const c of clients || []) {
    const weekNo = computeWeekNo(c.program_started_at);
    if (weekNo < 1) continue; // wait until week 1 has elapsed

    // Skip if a check-in for this week already exists.
    const { data: existing } = await supa
      .from('checkins').select('id')
      .eq('client_id', c.id).eq('week_no', weekNo).maybeSingle();
    if (existing) continue;

    const market = marketForPhone(c.phone);
    const t = template('checkin_request', market, {
      week_no: String(weekNo),
      form_url: checkinUrl(c.id, weekNo),
    });
    await sendWhatsApp({
      phone: c.phone, body: t.body, templateName: t.name, bypassRateLimit: true,
      meta: { kind: 'checkin_request', week_no: weekNo },
    });
    sent++;
  }

  return res.status(200).json({ ok: true, sent });
}

function computeWeekNo(startedAt) {
  // Returns the week number that JUST FINISHED.
  // Day 0-6  → 0  (no check-in yet — wait one full week)
  // Day 7-13 → 1  (Week 1 just ended → request Week 1 check-in)
  // Day 14-20 → 2 ...
  const start = new Date(startedAt).getTime();
  const days = Math.floor((Date.now() - start) / 86400_000);
  return Math.floor(days / 7);
}
