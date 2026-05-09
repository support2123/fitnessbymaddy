const { getSupabase } = require('../_lib/supabase');
const { canSendMessage, sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;

    for (const lead of reEngageLeads) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = lead.market || 'GLOBAL';
      const templateName = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';

      const success = await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/program-trial.html'
      ], lead.name);

      if (success) {
        sent++;
        await db.from('leads').update({
          status: 'new',
          last_msg_at: new Date().toISOString()
        }).eq('id', lead.id);
      }
    }

    return res.status(200).json({ sent, total_eligible: reEngageLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
