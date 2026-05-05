const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, market:leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Send check-in form link
      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.market?.market || detectMarket(client.phone);
      const templateName = market === 'IN' ? 'weekly_checkin_hindi' : 'weekly_checkin';

      const result = await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        formUrl
      ]);

      if (result.success) {
        sent++;
      } else {
        errors++;
      }
    }

    return res.status(200).json({ message: 'Weekly check-in sent', sent, errors, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
