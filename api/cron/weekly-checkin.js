const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!lead_id(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString())
      .gte('program_ends_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
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

        const market = client.leads?.market || 'GLOBAL';
        const hinglish = isHinglishMarket(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const body = hinglish
          ? `Hey ${client.name || 'Champion'}! Week ${weekNo} check-in time! Apna weight, waist, photos aur feedback yahan submit karo:\n\n${checkinUrl}\n\nConsistency hi key hai — keep going!`
          : `Hey ${client.name || 'Champion'}! It's Week ${weekNo} check-in time! Submit your weight, waist, photos and feedback here:\n\n${checkinUrl}\n\nConsistency is key — keep going!`;

        const result = await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          body,
          params: [client.name || 'Champion', String(weekNo), checkinUrl]
        });

        if (result.sent) sent++;
        else errors++;
      } catch (err) {
        console.error(`Check-in send error for ${maskPhone(client.phone)}:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
