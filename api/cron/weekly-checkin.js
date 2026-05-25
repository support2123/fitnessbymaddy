const { supabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');
const { isHinglishMarket, detectMarket, maskPhone } = require('../_lib/helpers');
const { escalate } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let processed = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysDiff / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      if (missedCount === 0 && weekNo > 2) {
        await escalate(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || maskPhone(client.phone)} has missed 2 consecutive weekly check-ins.`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglishMarket(market);

      const msg = hinglish
        ? `Hey ${client.name || 'Champion'}! 📋 Week ${weekNo} check-in time!\n\nApna progress share karo:\n${checkinUrl}\n\nWeight, waist, compliance score aur photos daal do. Let's keep the momentum going! 💪`
        : `Hey ${client.name || 'Champion'}! 📋 Time for your Week ${weekNo} check-in!\n\nShare your progress here:\n${checkinUrl}\n\nUpdate your weight, waist, compliance score and progress photos. Let's keep pushing! 💪`;

      await sendText(client.phone, msg, true);
      processed++;
    }

    return res.json({ ok: true, processed, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
