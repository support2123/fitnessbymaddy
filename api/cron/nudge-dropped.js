const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  let nudged = 0;
  let skipped = 0;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    for (const lead of newLeads) {
      try {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]);
          nudged++;
        } else if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          skipped++;
        }
      } catch (err) {
        console.error(`Nudge error for lead ${lead.id}:`, err.message);
      }
    }

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const daysSinceDropped = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceDropped >= 5 && daysSinceDropped <= 7) {
          const { data: msgs } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengage_7day')
            .limit(1);

          if (!msgs || msgs.length === 0) {
            await sendTemplate(lead.phone, 'reengage_7day', [
              lead.name || 'there'
            ]);
            reengaged++;
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped: skipped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
