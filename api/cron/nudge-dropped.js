const { getClient } = require('../../lib/supabase');
const { sendTemplate, logMessage, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - REENGAGEMENT_WINDOW_DAYS);

    const { data: nudgeableLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (!nudgeableLeads || nudgeableLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;
    for (const lead of nudgeableLeads) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/shred.html',
      ]);
      await logMessage(lead.phone, 'out', '[Re-engagement nudge]', 'nudge_trial');

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);

      nudged++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    return res.status(200).json({
      nudged,
      staleDropped: staleLeads?.length || 0,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
