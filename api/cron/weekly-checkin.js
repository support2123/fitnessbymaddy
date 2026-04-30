const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const weeksElapsed = Math.floor(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const currentWeek = weeksElapsed + 1;

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      let hinglish = false;
      if (client.lead_id) {
        const { data: lead } = await supabase
          .from('leads')
          .select('market')
          .eq('id', client.lead_id)
          .single();
        hinglish = lead ? isHinglish(lead.market) : false;
      }

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: hinglish
          ? `Hey ${client.name || 'there'}! 📋 Week ${currentWeek} check-in time!\n\nForm yahan fill karo: ${checkinUrl}\n\nPhotos + stats daal do — isse next week ka plan better banega.`
          : `Hey ${client.name || 'there'}! 📋 Time for your Week ${currentWeek} check-in!\n\nFill it here: ${checkinUrl}\n\nInclude photos + stats — it helps us tailor your next week.`,
        params: [client.name || 'there', String(currentWeek), checkinUrl]
      });

      sent++;

      const { data: lastWeekCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek - 1)
        .single();

      if (!lastWeekCheckin && currentWeek > 1) {
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, sent, nudged, total_clients: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
