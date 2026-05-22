const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    const results = [];

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey ${client.name || 'there'}! \u{1F4CA} Week ${weekNo} check-in time!\n\nApna progress share karo — weight, measurements, aur photos.\n\n\u{1F449} ${checkinUrl}\n\n5 min lagega, but ye bahut important hai progress ke liye!`
        : `Hey ${client.name || 'there'}! \u{1F4CA} It's Week ${weekNo} check-in time!\n\nShare your progress — weight, measurements, and photos.\n\n\u{1F449} ${checkinUrl}\n\nTakes 5 minutes, but it's crucial for tracking your progress!`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'there', String(weekNo)],
        body
      });

      await checkMissedCheckins(client.id, client.phone);

      results.push({ clientId: client.id, weekNo, sent: true });
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      results
    });
  } catch (error) {
    console.error('Weekly check-in cron error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
