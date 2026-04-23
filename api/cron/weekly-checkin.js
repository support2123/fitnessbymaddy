const { getClient } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { checkMissedCheckins, createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Vercel Cron sends GET requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isInternal && req.method === 'POST') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      // Don't send check-in past program end
      const endDate = new Date(client.program_ends_at);
      if (Date.now() > endDate.getTime()) continue;

      // Check for 2 consecutive missed check-ins → escalate
      const missed = await checkMissedCheckins(client.id);
      if (missed) {
        await createEscalation({
          phone: client.phone,
          clientId: client.id,
          reason: '2 consecutive missed check-ins',
          messageBody: `Client has missed check-ins for weeks leading up to week ${weeksElapsed}`
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const firstName = (client.name || 'there').split(' ')[0];

      const msg = hinglish
        ? `Hey ${firstName}! 📋 Week ${weeksElapsed} ka check-in time hai!\n\nWeight, waist, photos aur apna progress update kar:\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksElapsed}\n\n5 min lagega — tera progress track karna zaroori hai! 💪`
        : `Hey ${firstName}! 📋 It's time for your Week ${weeksElapsed} check-in!\n\nUpdate your weight, waist, photos and progress:\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksElapsed}\n\nTakes 5 minutes — tracking your progress is key! 💪`;

      const result = await sendWhatsApp({ phone: client.phone, body: msg });
      if (result.sent) sent++;
    }

    return res.json({ message: 'Weekly check-in sent', sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
