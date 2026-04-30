const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const { data: stalledLeads, error } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoDaysAgo.toISOString())
    .gt('created_at', sevenDaysAgo.toISOString());

  if (error) {
    console.error('nudge-dropped: query error', error.message);
    return res.status(500).json({ error: 'Query failed' });
  }

  let nudged = 0;
  let dropped = 0;

  for (const lead of stalledLeads || []) {
    const hoursSinceLastMsg =
      (Date.now() - new Date(lead.last_msg_at).getTime()) / 3600000;

    if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 72) {
      const canSend = await canSendToLead(lead.phone);
      if (canSend) {
        const template = lead.market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html',
        ]);
        nudged++;
      }
    } else if (hoursSinceLastMsg >= 72) {
      await db
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }
  }

  return res.status(200).json({ ok: true, nudged, dropped, checked: (stalledLeads || []).length });
};
