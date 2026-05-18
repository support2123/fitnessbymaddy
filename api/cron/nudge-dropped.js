const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake?lead=' + lead.id
        ]);
        nudged++;
      }
    }

    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ]);
        reEngaged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
