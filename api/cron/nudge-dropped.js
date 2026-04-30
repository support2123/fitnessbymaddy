const supabase = require('../../lib/supabase');
const { sendTemplate, sendTextMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement');

      if (count && count >= 1) continue;

      const hinglish = isHinglish(lead.market);

      await sendTemplate(lead.phone, 'nudge_reengagement', {
        name: lead.name || 'there',
        templateParams: hinglish
          ? [lead.name || 'Hey', 'Maddy ka $20 Zoom trial abhi bhi available hai — ek session mein pura plan milega. Try karna hai?']
          : [lead.name || 'Hey', 'Maddy\'s $20 Zoom trial is still available — get a full plan in one session. Want to try?']
      });

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: pendingNudges } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active')
      .not('id', 'in', `(${await getPendingCheckinClientIds()})`);

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      total_checked: droppedLeads.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckinClientIds() {
  const sunday = getLastSunday();
  const { data } = await supabase
    .from('checkins')
    .select('client_id')
    .gte('form_submitted_at', sunday.toISOString());

  return data?.map(c => c.client_id).join(',') || '';
}

function getLastSunday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}
