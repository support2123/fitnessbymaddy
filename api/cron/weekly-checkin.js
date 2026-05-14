const { supabase } = require('../_lib/supabase');
const { sendWhatsAppUnlimited } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');
const { isHinglishMarket, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients } = await supabase
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
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          clientName: client.name,
          details: `${consecutiveMissed} weeks without check-in. Last submitted: Week ${lastSubmittedWeek}`
        });
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglishMarket(market);

      await sendWhatsAppUnlimited({
        phone: client.phone,
        templateName: hinglish ? 'weekly_checkin_hi' : 'weekly_checkin',
        params: [client.name || 'there', `${currentWeek}`, checkinUrl]
      });

      results.push({
        client_id: client.id,
        week: currentWeek,
        status: 'checkin_sent'
      });
    }

    return res.status(200).json({
      action: 'weekly_checkins_processed',
      processed: results.length,
      results
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
