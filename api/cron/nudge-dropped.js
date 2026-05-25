const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twoHoursAgo.toISOString())
      .gt('last_msg_at', twentyFourHoursAgo.toISOString());

    let nudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo.toISOString());

        if (count === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake',
          ]);
          nudged++;
        }
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gt('created_at', sevenDaysAgo.toISOString());

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_offer');

        if (count === 0) {
          await sendWhatsApp(lead.phone, 'reengage_offer', [
            lead.name || 'there',
          ]);
          reengaged++;
        }
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
