const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sb = getSupabase();

    const { data: activeClients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const { data: lastTwoCheckins } = await sb
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        if (lastTwoCheckins && lastTwoCheckins.length >= 2) {
          const missedWeeks = currentWeek - lastTwoCheckins[0].week_no;
          if (missedWeeks >= 2) {
            await sb.from('escalations').insert({
              phone: client.phone,
              client_id: client.id,
              reason: '2 consecutive missed check-ins'
            });
            await notifyMaddy(
              '2 missed check-ins',
              `Client: ${maskPhone(client.phone)} (${client.name || 'Unknown'})\nLast check-in: Week ${lastTwoCheckins[0].week_no}\nCurrent week: ${currentWeek}`
            );
          }
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);
        const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);

        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: activeClients.length,
      sent,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
