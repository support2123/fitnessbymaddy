const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
      .gt('last_msg_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of (newLeads || [])) {
      const allowed = await canSendToLead(lead.phone);
      if (allowed) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        await db.from('leads').update({ last_msg_at: now.toISOString() }).eq('id', lead.id);
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', fourteenDaysAgo.toISOString());

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const allowed = await canSendToLead(lead.phone);
      if (allowed) {
        await sendTemplate(lead.phone, 'reengage_v1', [lead.name || 'there']);
        await db.from('leads').update({ last_msg_at: now.toISOString() }).eq('id', lead.id);
        reEngaged++;
      }
    }

    return res.json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reEngaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
