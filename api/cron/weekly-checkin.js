import { getSupabase } from '../_lib/supabase.js';
import { sendClientMessage } from '../_lib/whatsapp.js';
import { escalateToMaddy } from '../_lib/escalate.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

  try {
    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: existingCheckin } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const { data: missedCheckins } = await db.from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        const lastTwoExpected = [currentWeek - 1, currentWeek - 2].filter(w => w > 0);
        const consecutiveMissed = lastTwoExpected.filter(w => !submittedWeeks.includes(w)).length;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            clientName: client.name,
            phone: client.phone,
            message: `Missed weeks: ${lastTwoExpected.filter(w => !submittedWeeks.includes(w)).join(', ')}`
          });
          results.escalated++;
        }

        const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        await sendClientMessage(client.phone, 'weekly_checkin', [
          client.name || 'there',
          `${currentWeek}`,
          formUrl
        ]);

        await db.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: `Week ${currentWeek} check-in form sent: ${formUrl}`,
          template_name: 'weekly_checkin',
          status: 'sent'
        });

        results.sent++;
      } catch (clientErr) {
        console.error(`Error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
