const { getSupabase } = require('../lib/supabase');
const { sendAndLog } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const SITE = 'https://www.fitnessbymaddy.com';
const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          skipped++;
          continue;
        }

        const checkinLink = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;

        await sendAndLog(
          client.phone,
          'weekly_checkin',
          [client.name || 'there', `${weekNo}`, checkinLink],
          true
        );
        sent++;
      } catch (e) {
        errors.push({ client_id: client.id, error: e.message });
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, e.message);
      }
    }

    const { data: pendingCheckins } = await db.rpc('get_missed_checkins_count', {}).catch(() => ({ data: null }));

    console.log(`Weekly checkin cron: sent=${sent}, skipped=${skipped}, errors=${errors.length}`);
    return res.status(200).json({ sent, skipped, errors: errors.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
