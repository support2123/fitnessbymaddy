const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // FLOW A step 3: nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          const { data: nudges } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (!nudges || nudges.length === 0) {
            await sendWhatsApp(lead.phone, 'nudge_trial', [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html'
            ]);
            nudged++;
          }
        }
      }
    }

    // FLOW A step 4: drop leads with no reply after 24 hours
    const { data: leadsToDropRaw } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (leadsToDropRaw) {
      for (const lead of leadsToDropRaw) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7 days ago, one final try
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reEngageMessages || reEngageMessages.length === 0) {
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

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
