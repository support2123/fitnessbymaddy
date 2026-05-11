const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const maxWeeks = client.program.startsWith('6wk') ? 6 :
                       client.program === '12wk' ? 12 : 8;

      if (weekNo > maxWeeks) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted', week: weekNo });
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl
        ]
      });

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (recentCheckins && recentCheckins.length > 0) {
        const lastWeek = recentCheckins[0].week_no;
        if (weekNo - lastWeek >= 3) {
          await escalateToMaddy('2+ consecutive missed check-ins', {
            phone: maskPhone(client.phone),
            message: `Last check-in was week ${lastWeek}, now on week ${weekNo}`,
            clientName: client.name || 'Unknown'
          });
        }
      }
    }

    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function isVercelCron(req) {
  return req.headers['user-agent']?.includes('vercel-cron');
}
