const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !clients) {
    console.error('Failed to fetch clients:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

    const endDate = new Date(client.program_ends_at);
    if (now > endDate) {
      await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
      skipped++;
      continue;
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const hinglish = isHinglish(client.market || 'GLOBAL');

    await sendWhatsApp({
      phone: client.phone,
      templateName: hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en',
      params: [client.name || 'there', String(weekNo), checkinUrl]
    });

    sent++;
  }

  await checkMissedCheckins(db);

  console.log(`Weekly check-in: ${sent} sent, ${skipped} skipped`);
  return res.status(200).json({ ok: true, sent, skipped });
};
