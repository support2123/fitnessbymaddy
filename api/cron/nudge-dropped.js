const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: nudgeLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  let nudged = 0;
  if (nudgeLeads) {
    for (const lead of nudgeLeads) {
      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html'
      ]);
      nudged++;
    }
  }

  const { data: dropLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  let dropped = 0;
  if (dropLeads) {
    for (const lead of dropLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', sevenDaysAgo);

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!recentMsg || recentMsg.length === 0) {
        await sendWhatsApp(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ]);
        reEngaged++;
      }
    }
  }

  return res.status(200).json({
    success: true,
    nudged,
    dropped,
    re_engaged: reEngaged
  });
};
