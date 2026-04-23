const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalate } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients } = await supabase()
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysDiff / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase()
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await supabase()
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      if (expectedCheckins - (missedCount || 0) >= 2) {
        await escalate(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || client.id} has not checked in for 2+ weeks`
        );
        escalated++;
      }

      if (await canSendMessage(client.phone, true)) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
        sent++;
      }
    }

    return res.status(200).json({
      success: true,
      total_clients: clients.length,
      checkins_sent: sent,
      escalations: escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
