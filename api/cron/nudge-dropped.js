// Cron: daily.
// Re-engage leads that went `dropped` ≥ 7 days ago, only once.
import { db } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { template } from '../_lib/templates.js';
import { marketForPhone } from '../_lib/market.js';
import { trialUrl } from '../_lib/checkout.js';
import { requireCronAuth } from '../_lib/util.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req)) return res.status(401).json({ ok: false });

  const supa = db();
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: leads } = await supa
    .from('leads')
    .select('id,phone,last_msg_at,created_at')
    .eq('status', 'dropped')
    .lt('last_msg_at', cutoff);

  let sent = 0;
  for (const l of leads || []) {
    // Skip if we've already sent a re-engage message.
    const { data: prev } = await supa
      .from('messages').select('id')
      .eq('phone', l.phone).eq('template_name', 'reengage_dropped').limit(1);
    if (prev && prev.length) continue;

    const market = marketForPhone(l.phone);
    const t = template('reengage_dropped', market, { trial_url: trialUrl() });
    await sendWhatsApp({
      phone: l.phone, body: t.body, templateName: t.name, bypassRateLimit: true,
      meta: { kind: 'reengage' },
    });
    sent++;
  }

  return res.status(200).json({ ok: true, sent });
}
