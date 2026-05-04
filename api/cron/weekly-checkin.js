const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missed } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const recentWeeks = (missed || []).map(c => c.week_no);
      const missedConsecutive = weekNo >= 3 &&
        !recentWeeks.includes(weekNo - 1) &&
        !recentWeeks.includes(weekNo - 2);

      if (missedConsecutive) {
        await sendText(MADDY_PHONE,
          `2 MISSED CHECK-INS: ${client.name || maskPhone(client.phone)}\n` +
          `Program: ${client.program} | Week ${weekNo}\n` +
          `Please follow up personally.`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const { data: lead } = client.lead_id
        ? await supabase.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead ? lead.market : 'GLOBAL';

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'Champion',
        String(weekNo),
        checkinUrl
      ]);

      sent++;
    }

    console.log(`Weekly checkin: sent=${sent}, escalated=${escalated}`);
    return res.status(200).json({ sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
