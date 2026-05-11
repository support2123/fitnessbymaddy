const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers['authorization'];
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let nudged = 0;
    for (const lead of (newLeads || [])) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .gte('sent_at', sevenDaysAgo)
        .single();

      if (recentMsg) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_reengagement',
        bodyValues: [lead.name || 'there'],
      });
      nudged++;
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (pendingCheckins || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const { data: lastNudge } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .eq('template_name', 'checkin_reminder')
        .gte('sent_at', twoDaysAgo)
        .single();

      if (lastNudge) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'checkin_reminder',
        bodyValues: [client.name || 'Champion', checkinUrl],
      });
      checkinNudges++;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      if (missedCount === 0 && weekNo > 2) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('missed_checkins', client.phone, `2 consecutive missed check-ins (week ${weekNo})`);
      }
    }

    return res.status(200).json({ success: true, nudged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}
