const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket } = require('../_lib/whatsapp');
const { weekNumber } = require('../_lib/helpers');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();

  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name, program, program_started_at')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.json({ ok: true, sent: 0 });
  }

  let sent = 0;
  let nudged = 0;

  for (const client of clients) {
    const wk = weekNumber(client.program_started_at);
    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${wk}`;

    const { data: existing } = await db
      .from('checkins')
      .select('id, form_submitted_at')
      .eq('client_id', client.id)
      .eq('week_no', wk)
      .single();

    if (existing?.form_submitted_at) continue;

    const { data: prevWeek } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', wk - 1)
      .is('form_submitted_at', null)
      .single();

    const { data: prevPrevWeek } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', wk - 2)
      .is('form_submitted_at', null)
      .single();

    if (prevWeek && prevPrevWeek) {
      await escalateToMaddy(
        '2_consecutive_missed_checkins',
        client.phone,
        `${client.name || 'Client'} missed weeks ${wk - 2} and ${wk - 1}`
      );
    }

    const market = detectMarket(client.phone);
    const msg = market === 'IN'
      ? [`Hey ${client.name || 'there'}! Weekly check-in time ✅\n\nForm yahan fill karo: ${checkinUrl}\n\nWeight, waist, photos, aur energy level — sab update kardo!`]
      : [`Hey ${client.name || 'there'}! Time for your weekly check-in ✅\n\nFill it here: ${checkinUrl}\n\nUpdate your weight, waist, photos, and energy level!`];

    await sendTemplate(client.phone, 'weekly_checkin', msg);

    await db.from('checkins').upsert({
      client_id: client.id,
      week_no: wk,
      form_submitted_at: null
    }, { onConflict: 'client_id,week_no', ignoreDuplicates: true });

    sent++;
  }

  return res.json({ ok: true, sent, nudged });
};
