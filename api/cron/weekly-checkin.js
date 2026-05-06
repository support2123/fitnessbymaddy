const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { verifyCron, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let missed2 = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (currentWeek > maxWeeks) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: lastCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (lastCheckins || []).map(c => c.week_no);

      if (submittedWeeks.length >= 2) {
        const last2Expected = [currentWeek - 1, currentWeek - 2];
        const missedBoth = last2Expected.every(w => !submittedWeeks.includes(w));
        if (missedBoth) {
          missed2++;
          await notifyMaddy(
            client.phone,
            `2 consecutive missed check-ins (W${currentWeek})`,
            `Client ${client.name || maskPhone(client.phone)} has missed 2 check-ins in a row.`
          );
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `Week ${currentWeek}`,
        checkinUrl,
      ]);

      sent++;
      console.log(`Checkin sent: ${maskPhone(client.phone)} W${currentWeek}`);
    }

    console.log(`Weekly checkin cron: ${sent} sent, ${missed2} escalated`);
    return res.status(200).json({ ok: true, sent, escalated: missed2 });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
