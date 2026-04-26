const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmittedWeek = missedCheckins && missedCheckins.length > 0
          ? missedCheckins[0].week_no : 0;
        const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            name: client.name,
            message: `Client has missed ${consecutiveMissed} consecutive check-ins (last submitted: week ${lastSubmittedWeek}, current: week ${weekNo})`
          });
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = client.leads ? client.leads.market : 'GLOBAL';
        const hinglish = isHinglish(market);

        const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      message: `Check-in reminders sent`,
      sent,
      total_active: activeClients.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
