const { supabase } = require('../../lib/supabase');
const { sendWhatsAppText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const weeksActive = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksActive < 1) continue;

      await checkMissedCheckins(client.id);

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksActive}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weeksActive} check-in ka time aa gaya. Apna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos aur compliance score submit karo.`
        : `Hey ${client.name || 'there'}! It's time for your Week ${weeksActive} check-in. Update your progress here:\n${checkinUrl}\n\nSubmit your weight, waist, photos, and compliance score.`;

      await sendWhatsAppText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
