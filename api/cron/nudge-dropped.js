const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage, canSendTo } = require('../../lib/messages');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0 };

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of newLeads) {
      try {
        const allowed = await canSendTo(lead.phone);
        if (!allowed) {
          results.skipped++;
          continue;
        }

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', 'Nudge: trial offer', 'nudge_trial');

        const now = new Date();
        const hoursSinceCreated = (now.getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }

        results.nudged++;
      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
