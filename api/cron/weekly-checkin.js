const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { generateToken, maskPhone } = require('../lib/helpers');

const PROGRAM_WEEKS = {
  '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
  'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const summary = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: clients, error: fetchErr } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    if (fetchErr) {
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ...summary, message: 'No active clients' });
    }

    const now = new Date();

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weekNo = Math.floor((now - startDate) / msPerWeek) + 1;
        const maxWeeks = PROGRAM_WEEKS[client.program] || 12;

        if (weekNo > maxWeeks) {
          summary.skipped++;
          continue;
        }

        // Guard against duplicate sends
        const recentCutoff = new Date(now - 20 * 60 * 60 * 1000).toISOString();
        const { data: recentSends } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'weekly_checkin')
          .gte('sent_at', recentCutoff)
          .limit(1);

        if (recentSends && recentSends.length > 0) {
          summary.skipped++;
          continue;
        }

        const token = generateToken();

        const { error: insertErr } = await supabase.from('checkins').insert({
          client_id: client.id,
          week_no: weekNo,
          token,
        });

        if (insertErr) {
          console.error(`Checkin insert for ${maskPhone(client.phone)}:`, insertErr.message);
          summary.errors++;
          continue;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}&t=${token}`;

        const result = await sendWhatsApp(client.phone, 'weekly_checkin', {
          templateParams: [client.name || 'there', String(weekNo), checkinUrl],
        });

        if (!result.success) {
          summary.errors++;
          continue;
        }

        summary.sent++;
        console.log(`Sent check-in to ${maskPhone(client.phone)} (week ${weekNo})`);
      } catch (clientErr) {
        console.error(`Error for ${maskPhone(client.phone)}:`, clientErr.message);
        summary.errors++;
      }
    }

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
