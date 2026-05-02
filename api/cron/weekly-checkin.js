const { supabase } = require('../_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const diffMs = now.getTime() - startDate.getTime();
      const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: lastTwo } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedConsecutive = lastTwo
        && lastTwo.length >= 1
        && weekNo - lastTwo[0].week_no >= 2;

      if (missedConsecutive) {
        await sendWhatsAppWithRateLimit(
          MADDY_PHONE,
          'escalation_alert',
          [maskPhone(client.phone), `${client.name || 'Client'} missed 2+ check-ins (week ${weekNo})`],
          'Maddy',
          true
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsAppWithRateLimit(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(weekNo), checkinUrl],
        client.name || 'there',
        true
      );

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
