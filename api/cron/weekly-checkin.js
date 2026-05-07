const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (existing && existing.form_submitted_at) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .is('form_submitted_at', null)
        .order('week_no', { ascending: false })
        .limit(3);

      const consecutiveMissed = missedCheckins ? missedCheckins.length : 0;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} — ${client.program}, week ${weekNo}`
        );
        escalated++;
      }

      if (!existing) {
        await supabase.from('checkins').insert({
          client_id: client.id,
          week_no: weekNo,
        });
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'IN';
      const template = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      await sendTemplate(client.phone, template, [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({
      success: true,
      sent,
      escalated,
      total: activeClients.length,
    });
  } catch (err) {
    console.error('[cron/weekly-checkin]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
