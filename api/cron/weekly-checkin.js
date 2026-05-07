const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/messages');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) {
          results.skipped++;
          continue;
        }

        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) {
          await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        let msg;
        if (market === 'IN') {
          msg = `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress share karo — weight, waist, photos.\n\n${checkinUrl}`;
        } else {
          msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Share your progress — weight, waist, and photos.\n\n${checkinUrl}`;
        }

        await sendWhatsApp(client.phone, 'weekly_checkin', [msg]);
        await logMessage(client.phone, 'out', msg, 'weekly_checkin');

        results.sent++;
      } catch (clientErr) {
        console.error(`Check-in error for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
