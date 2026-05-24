const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateCurrentWeek(client.program_started_at);
      const programWeeks = getProgramWeeks(client.program);

      if (weekNo > programWeeks) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missed } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const consecutiveMissed = missed
        ? weekNo - 1 - (missed[0]?.week_no || 0)
        : weekNo - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('missed_checkins', {
          phone: client.phone,
          message: `${client.name || 'Client'} missed ${consecutiveMissed} consecutive check-ins (Week ${weekNo})`
        });
        escalated++;
      }

      const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinLink
      ]);
      sent++;
    }

    return res.status(200).json({ success: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}

function getProgramWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[program] || 6;
}
