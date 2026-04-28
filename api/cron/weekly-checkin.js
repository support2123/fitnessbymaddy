const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      if (missedCount < expectedCheckins - 1) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          name: client.name,
          message: `Client has missed ${expectedCheckins - (missedCount || 0)} recent check-ins (Week ${weekNo})`
        });
        escalated++;
      }

      const { data: lead } = client.lead_id
        ? await db.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead?.market || 'GLOBAL';
      const hinglish = isHinglish(market);

      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const body = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress fill karo:\n${formUrl}\n\nWeight, waist, compliance, energy + 3 photos upload karo.`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Fill in your progress:\n${formUrl}\n\nInclude your weight, waist, compliance, energy levels + 3 progress photos.`;

      await sendWhatsApp({ phone: client.phone, body });
      sent++;
    }

    return res.status(200).json({
      status: 'completed',
      clients_processed: activeClients.length,
      checkins_sent: sent,
      escalations: escalated
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
