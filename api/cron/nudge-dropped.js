const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);

  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_new: 0, nudged_trial: 0, dropped: 0, errors: 0 };
    const now = new Date();

    // FLOW 1: Nudge new leads after 2 hours with no reply
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        // Check if they've replied since creation
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/shred.html'
          ], false);
          results.nudged_trial++;
        }
      }
    }

    // FLOW 2: Drop leads that haven't replied in 24 hours
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await db.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          results.dropped++;
        }
      }
    }

    // FLOW 3: Re-engage dropped leads (7-day rule — only once)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        // Check we haven't already sent a re-engage
        const { data: reengageMsgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reengageMsgs || reengageMsgs.length === 0) {
          await sendWhatsApp(lead.phone, 'reengage_7day', [
            lead.name || 'there'
          ], false);
          results.nudged_new++;
        }
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
