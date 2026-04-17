const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program', 'eq', 'zoom_trial');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);

        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarketFromPhone(client.phone);
        const template = market === 'IN' ? 'weekly_checkin' : 'weekly_checkin_en';

        await sendWhatsApp(client.phone, template, [
          client.name || 'there',
          `Week ${weekNo}`,
          checkinUrl,
        ]);

        sent++;
      } catch (err) {
        console.error(`[weekly-checkin] Error for client ${client.id}:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('[weekly-checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function detectMarketFromPhone(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}
