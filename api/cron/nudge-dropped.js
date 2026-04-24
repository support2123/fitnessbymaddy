const { getSupabase, TABLES } = require('../_utils/supabase');
const { sendTemplate } = require('../_utils/whatsapp');
const { isHinglish } = require('../_utils/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: newLeads } = await db
      .from(TABLES.LEADS)
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', new Date(now - 2 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const createdAt = new Date(lead.created_at);
        const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await db.from(TABLES.LEADS).update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceCreated >= 2) {
          const templateName = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendTemplate(lead.phone, templateName, [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html',
          ]);
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const { data: droppedLeads } = await db
      .from(TABLES.LEADS)
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo.toISOString())
      .is('reengaged_at', null);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const daysSinceDropped = (now - new Date(lead.last_msg_at || lead.created_at)) / (1000 * 60 * 60 * 24);

        if (daysSinceDropped >= 3 && daysSinceDropped <= 7) {
          const templateName = isHinglish(lead.market) ? 'reengage_hi' : 'reengage_en';
          await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
          await db.from(TABLES.LEADS).update({ reengaged_at: now.toISOString() }).eq('id', lead.id);
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
