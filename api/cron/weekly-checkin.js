const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      if (weekNo > 2 && (missedCount || 0) === 0) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} has missed check-ins for weeks ${weekNo - 2} and ${weekNo - 1}`
        );
      }

      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || ''}! Week ${weekNo} ka check-in time hai 💪\nApna progress share karo: ${formUrl}`
        : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in 💪\nShare your progress: ${formUrl}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        formUrl,
      ]);

      results.push({ client_id: client.id, week_no: weekNo, action: 'sent' });
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
