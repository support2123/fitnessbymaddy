const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);

        if (weekNo < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (existingCheckin) continue;

        const { data: lead } = client.lead_id
          ? await db.from('leads').select('market').eq('id', client.lead_id).single()
          : { data: null };

        const market = lead?.market || 'GLOBAL';
        const hinglish = isHinglish(market);
        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const body = hinglish
          ? `Hey ${client.name || ''}! 💪 Week ${weekNo} ka check-in time hai!\n\n` +
            `📋 Form fill karo: ${formUrl}\n\n` +
            `Weight, waist, compliance aur photos share karo — toh main tumhara next week ka plan banaungi!`
          : `Hey ${client.name || ''}! 💪 Time for your Week ${weekNo} check-in!\n\n` +
            `📋 Fill the form: ${formUrl}\n\n` +
            `Share your weight, waist, compliance & photos — so I can build your next week's plan!`;

        const result = await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          bodyValues: [body],
        });

        if (result.sent) results.sent++;

        const prevWeek = weekNo - 1;
        if (prevWeek >= 2) {
          const { data: prevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', prevWeek)
            .limit(1)
            .single();

          const { data: prevPrevCheckin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', prevWeek - 1)
            .limit(1)
            .single();

          if (!prevCheckin && !prevPrevCheckin) {
            await escalateToMaddy({
              reason: '2 consecutive missed check-ins',
              phone: client.phone,
              context: `Client: ${client.name}, Program: ${client.program}, Weeks missed: ${prevWeek - 1} & ${prevWeek}`,
            });
            results.escalated++;
          }
        }
      } catch (e) {
        console.error(`Check-in error for client ${client.id}:`, e.message);
        results.errors++;
      }
    }

    return res.json({ message: 'Weekly check-in cron complete', results });
  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}
