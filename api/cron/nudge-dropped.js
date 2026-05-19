const { getClient } = require('../../lib/supabase');
const { sendTextMessage } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/escalation');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', eightDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!droppedLeads?.length) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { data: recent } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (recent) {
        const lastSent = new Date(recent.sent_at);
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        if (lastSent > twoHoursAgo) continue;
      }

      const market = lead.market || 'GLOBAL';
      const msg = market === 'IN'
        ? `Hey ${lead.name || 'there'}! 👋 Maddy ki team se hain. Humne aapko pichle hafte message kiya tha. Abhi bhi fitness goals pe kaam karna hai?\n\nHumare $20 trial session se start karo — koi commitment nahi:\nhttps://fitnessbymaddy.com/intake.html\n\nReply "STOP" to opt out.`
        : `Hey ${lead.name || 'there'}! 👋 This is Maddy's team. We reached out last week. Still working on your fitness goals?\n\nStart with our $20 trial session — no commitment:\nhttps://fitnessbymaddy.com/intake.html\n\nReply "STOP" to opt out.`;

      await sendTextMessage(lead.phone, msg);
      await logMessage(db, lead.phone, 'out', msg, 'nudge_7day');

      results.push({ lead_id: lead.id, phone: lead.phone });
    }

    return res.status(200).json({
      success: true,
      nudged: results.length,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
