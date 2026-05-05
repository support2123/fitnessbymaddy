const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) continue;

    const { data: lastTwo } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (lastTwo && lastTwo.length >= 2) {
      const expected1 = weekNo - 1;
      const expected2 = weekNo - 2;
      const submitted = lastTwo.map(c => c.week_no);
      if (!submitted.includes(expected1) && !submitted.includes(expected2)) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          message: `Client ${client.name} missed weeks ${expected1} and ${expected2}`
        });
      }
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const market = client.phone.startsWith('+91') || client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
    const template = market === 'IN' ? 'weekly_checkin_hindi' : 'weekly_checkin';

    await sendWhatsApp(client.phone, template, [
      client.name || 'there',
      String(weekNo),
      checkinUrl
    ]);

    results.push({ client_id: client.id, week_no: weekNo });
  }

  return res.status(200).json({ sent: results.length, details: results });
};
