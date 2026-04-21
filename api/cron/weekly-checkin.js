const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { weekNumber, maskPhone, isHinglish } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const wk = weekNumber(client.program_started_at);
      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', wk)
        .single();

      if (existingCheckin) continue;

      const { data: prevWeekCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', wk - 1)
        .single();

      const { data: twoPriorCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', wk - 2)
        .single();

      if (!prevWeekCheckin && !twoPriorCheckin && wk > 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client: ${client.name || maskPhone(client.phone)}, Program: ${client.program}, Week: ${wk}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${wk}`;
      const params = hinglish
        ? [client.name || 'there', wk.toString(), checkinUrl]
        : [client.name || 'there', wk.toString(), checkinUrl];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${nudged} nudged`);
    return res.status(200).json({ ok: true, sent, nudged });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
