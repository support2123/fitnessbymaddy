const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { canSendTo, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads who haven't replied in 2 hours
    const { data: unrepliedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;
    let reEngaged = 0;

    if (unrepliedLeads) {
      for (const lead of unrepliedLeads) {
        if (await canSendTo(lead.phone)) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          await logMessage(lead.phone, 'out', '[nudge_trial template]', 'nudge_trial');
          nudged++;
        }
      }
    }

    // Drop leads who haven't replied in 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one attempt)
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        if (await canSendTo(lead.phone)) {
          await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
          await logMessage(lead.phone, 'out', '[reengage_7day template]', 'reengage_7day');
          reEngaged++;
        }
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
