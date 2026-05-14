const { getClient } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getClient();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of newLeads) {
      const allowed = await canSendToLead(lead.phone);
      if (!allowed) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
      ]);
      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', sevenDaysAgo);

    if (staleNew && staleNew.length > 0) {
      const staleNewNoReply = [];
      for (const lead of staleNew) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', sevenDaysAgo)
          .limit(1)
          .single();

        if (!recentMsg) {
          staleNewNoReply.push(lead.id);
        }
      }

      if (staleNewNoReply.length > 0) {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .in('id', staleNewNoReply);
      }
    }

    return res.status(200).json({ nudged, dropped: 0 });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
