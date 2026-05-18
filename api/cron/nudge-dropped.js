const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = { sent: 0, skipped: 0 };

    for (const lead of droppedLeads) {
      try {
        const { data: recentMessages } = await supabase
          .from('messages')
          .select('template_name, sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengagement_7day')
          .order('sent_at', { ascending: false })
          .limit(1);

        if (recentMessages && recentMessages.length > 0) {
          results.skipped++;
          continue;
        }

        await sendTemplate(lead.phone, 'reengagement_7day', [
          lead.name || 'there'
        ]);

        results.sent++;
      } catch (leadErr) {
        console.error(`Nudge failed for lead ${lead.id}:`, leadErr.message);
      }
    }

    // Also nudge leads with no reply after 2 hours (Flow A, step 3)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', fourHoursAgo);

    if (newLeads && newLeads.length > 0) {
      for (const lead of newLeads) {
        const { data: inbound } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!inbound || inbound.length === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        }
      }
    }

    // Mark 24hr+ no-reply leads as dropped (Flow A, step 4)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
