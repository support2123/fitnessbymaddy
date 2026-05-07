const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, sendText, maskPhone, detectMarket } = require('../_lib/whatsapp');
const { logMessage } = require('../_lib/rate-limit');
const { MADDY_PHONE } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin?.form_submitted_at) continue;

        const { count: missedCount } = await db
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .is('form_submitted_at', null)
          .lt('week_no', weekNo);

        if (missedCount >= 2) {
          await sendTemplate(MADDY_PHONE, 'escalation_alert', [
            client.name || maskPhone(client.phone),
            `${missedCount} consecutive missed check-ins`,
            `Client may be disengaged — week ${weekNo}`
          ]);
          await logMessage(MADDY_PHONE, 'out', 'Missed checkin escalation', 'escalation_alert');
        }

        await db.from('checkins').upsert({
          client_id: client.id,
          week_no: weekNo,
          form_submitted_at: null
        }, { onConflict: 'client_id,week_no' });

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        const msg = market === 'IN'
          ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Form yahan fill karo:\n${checkinUrl}\n\nPhotos + stats daalo — Maddy next week ka plan iske basis pe banayengi!`
          : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in:\n${checkinUrl}\n\nSubmit your stats + photos — your next week's plan depends on it!`;

        await sendText(client.phone, msg);
        await logMessage(client.phone, 'out', msg, null);
        sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${errors} errors`);
    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
