const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: clients, error } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        const maxWeeks = client.program.startsWith('12') ? 12 : 6;

        if (weekNo > maxWeeks) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          continue;
        }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        await checkMissedCheckins(client.id, client.phone);

        const market = client.leads ? client.leads.market : 'IN';
        const hinglish = isHinglish(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: hinglish
            ? [client.name || 'there', String(weekNo), checkinUrl, 'Apna weekly check-in submit karo!']
            : [client.name || 'there', String(weekNo), checkinUrl, 'Time for your weekly check-in!']
        });

        sent++;
      } catch (e) {
        console.error(`Checkin send failed for ${client.id}:`, e.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
}
