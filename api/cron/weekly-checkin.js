const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && Date.now() > endDate.getTime()) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const { data: lead } = await supabase
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .single();

      const isIN = (lead?.market || 'GLOBAL') === 'IN';
      const msg = isIN
        ? `Hi ${client.name || ''}! Week ${weekNo} ka check-in time hai. Apna progress share karo: ${checkinUrl}`
        : `Hi ${client.name || ''}! Time for your Week ${weekNo} check-in. Share your progress here: ${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        body: msg,
        isClient: true
      });
      sent++;

      await checkMissedCheckins(client.id, client.phone);
    }

    return res.status(200).json({
      success: true,
      clients_processed: (activeClients || []).length,
      checkins_sent: sent
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
