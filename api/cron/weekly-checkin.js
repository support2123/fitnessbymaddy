import { supa } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { render, TEMPLATES } from '../_lib/templates.js';
import { marketFromPhone } from '../_lib/market.js';
import { checkinUrl } from '../_lib/router.js';
import { escalate } from '../_lib/escalation.js';
import { json } from '../_lib/http.js';

// Runs every Sunday 09:00 IST (03:30 UTC).
export default async function handler(req, res) {
  // Vercel cron hits with Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.authorization || '';
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = supa();
  const { data: clients, error } = await db.from('clients')
    .select('id, phone, name, program_started_at, program').eq('status', 'active');
  if (error) return json(res, 500, { error: error.message });

  let sent = 0, skipped = 0, flaggedMissed = 0;

  for (const c of clients || []) {
    const started = new Date(c.program_started_at);
    const weekNo = Math.max(1, Math.floor((Date.now() - started.getTime()) / (7 * 86400000)) + 1);
    const { lang } = marketFromPhone(c.phone);

    // Check for 2 consecutive missed check-ins
    const { data: last2 } = await db.from('checkins')
      .select('week_no').eq('client_id', c.id)
      .order('week_no', { ascending: false }).limit(2);
    const latestSubmitted = last2?.[0]?.week_no ?? 0;
    if (weekNo - latestSubmitted >= 3) {
      await escalate({
        phone: c.phone, clientId: c.id,
        reason: 'missed_checkins_2',
        context: `Latest submitted week ${latestSubmitted}, now week ${weekNo}.`
      });
      flaggedMissed++;
    }

    try {
      const url = checkinUrl(c.id, weekNo);
      await sendWhatsApp({
        to: c.phone,
        templateName: TEMPLATES.weekly_checkin_prompt.name,
        body: render('weekly_checkin_prompt', lang, {
          name: c.name || 'there', week: weekNo, url
        }),
        params: [c.name || 'there', String(weekNo), url],
        bypassRateLimit: true
      });
      sent++;
    } catch (e) {
      console.error('checkin send failed', e.message);
      skipped++;
    }
  }

  return json(res, 200, { ok: true, sent, skipped, flagged_missed: flaggedMissed });
}
