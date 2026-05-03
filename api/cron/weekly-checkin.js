const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin?.form_submitted_at) continue;

        const { data: lastTwoCheckins } = await db
          .from('checkins')
          .select('week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const consecutiveMisses = (lastTwoCheckins || [])
          .filter(c => !c.form_submitted_at).length;

        if (consecutiveMisses >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client: ${client.name}, Week: ${currentWeek}`
          );
          results.escalated++;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const params = hinglish
          ? [client.name || 'there', `Week ${currentWeek}`, checkinUrl]
          : [client.name || 'there', `Week ${currentWeek}`, checkinUrl];

        await sendTemplate(client.phone, 'weekly_checkin', params, true);
        results.sent++;

        console.log(`Check-in sent: ${maskPhone(client.phone)} week ${currentWeek}`);
      } catch (clientErr) {
        console.error(`Error for client ${client.id}: ${clientErr.message}`);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error(`Weekly checkin cron error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
