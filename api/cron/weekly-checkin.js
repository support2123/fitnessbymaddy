const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalate } = require('../../lib/escalation');
const { cors } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients?.length) return res.json({ sent: 0 });

  let sent = 0;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const existing = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing.data) continue;

    const { count: missedCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('week_no', weekNo - 2);

    const expectedCheckins = Math.min(weekNo, 2);
    const actualCheckins = missedCount || 0;

    if (weekNo >= 3 && actualCheckins === 0) {
      await escalate(client.phone, '2_consecutive_missed_checkins', `Client missed weeks ${weekNo - 1} and ${weekNo - 2} check-ins`, client.id);
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\nFill it here: ${checkinUrl}\n\nThis helps us fine-tune your program for even better results.`;

    await sendWhatsApp(client.phone, msg, null);
    sent++;
  }

  return res.json({ sent, total_clients: clients.length });
};
