const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = client.leads?.market || 'GLOBAL';
        const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

        const result = await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl
        ]);

        if (result.ok) {
          sent++;
        } else {
          errors++;
        }

        console.log(`Check-in sent to ${maskPhone(client.phone)}: week ${weekNo}`);
      } catch (e) {
        console.error(`Error for client ${client.id}:`, e.message);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: clients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
