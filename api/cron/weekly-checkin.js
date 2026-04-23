const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');
const { getCheckinUrl, maskPhone } = require('../../lib/helpers');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'db error' });
    }

    let sent = 0;
    let skipped = 0;
    const escalations = [];

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) {
        skipped++;
        continue;
      }

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 2; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        escalations.push(client);
      }

      const checkinUrl = getCheckinUrl(client.id, weekNo);
      await sendText(client.phone,
        `Hey ${client.name || 'champ'}! 📊 It's check-in time (Week ${weekNo}).\n\nFill out your weekly form here:\n${checkinUrl}\n\nTakes 2 mins — weight, waist, energy + photos. Let's track that progress! 💪`
      );
      sent++;
    }

    if (escalations.length > 0) {
      const names = escalations.map(c =>
        `${c.name || maskPhone(c.phone)} (${c.program})`
      ).join(', ');
      await sendText(MADDY_PHONE,
        `⚠️ 2+ consecutive missed check-ins: ${names}`
      );
    }

    return res.json({ ok: true, sent, skipped, escalations: escalations.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
