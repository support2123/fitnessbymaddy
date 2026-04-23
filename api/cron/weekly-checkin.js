const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getSupabase();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await sb
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: lastCheckin } = await sb
          .from('checkins')
          .select('week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastCheckin && lastCheckin.week_no >= currentWeek) {
          continue;
        }

        const { data: missedCheckins } = await sb
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const missedCount = currentWeek - (lastCheckin?.week_no || 0) - 1;
        if (missedCount >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || maskPhone(client.phone)} (${client.program})\nMissed weeks: ${missedCount}`
          );
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
        results.sent++;

        const nudgeAt24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const nudgeAt48h = new Date(Date.now() + 48 * 60 * 60 * 1000);

        await sb.from('messages').insert([
          {
            phone: client.phone,
            direction: 'out',
            body: `[Scheduled nudge at ${nudgeAt24h.toISOString()}]`,
            template_name: 'checkin_nudge_24h',
            status: 'scheduled',
            sent_at: nudgeAt24h.toISOString()
          },
          {
            phone: client.phone,
            direction: 'out',
            body: `[Scheduled nudge at ${nudgeAt48h.toISOString()}]`,
            template_name: 'checkin_nudge_48h',
            status: 'scheduled',
            sent_at: nudgeAt48h.toISOString()
          }
        ]);

      } catch (err) {
        console.error(`Error for client ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
