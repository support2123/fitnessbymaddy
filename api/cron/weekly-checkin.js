const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lt('program_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const weekNo = calculateCurrentWeek(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      await checkMissedCheckins(client.id);

      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarketFromPhone(client.phone);

      await sendWhatsApp(client.phone, 'weekly_checkin_v1', [
        client.name || 'Champion',
        weekNo.toString(),
        formUrl,
      ]);

      // Schedule +24hr nudge
      await supabase.from('messages').insert({
        phone: client.phone,
        direction: 'out',
        body: `Scheduled nudge for week ${weekNo}`,
        template_name: 'checkin_nudge_scheduled',
        status: 'scheduled',
        sent_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      results.push({ client_id: client.id, week_no: weekNo, action: 'checkin_sent' });
    }

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.ceil(diffDays / 7);
}

function detectMarketFromPhone(phone) {
  const { detectMarket } = require('../../lib/market');
  return detectMarket(phone);
}
