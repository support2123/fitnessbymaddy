const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsToNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const hoursSinceLastMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);
        const hinglish = isHinglish(lead.market);

        if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        } else if (hoursSinceLastMsg >= 2) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            bodyValues: [
              lead.name || 'there',
              hinglish
                ? 'Abhi tak soch rahe ho? Ek baar $20 trial try karo — results dikhe toh aage badhna 🔥'
                : 'Still thinking? Try our $20 trial — see results first, then decide 🔥',
              'https://www.fitnessbymaddy.com/program-trial.html',
            ],
          });
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const hinglish = isHinglish(lead.market);

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_dropped',
          bodyValues: [
            lead.name || 'there',
            hinglish
              ? 'Fitness goal abhi bhi wahi hai? Maddy ke saath 6 weeks mein visible results — guaranteed method 💪'
              : 'Still have that fitness goal? Get visible results in 6 weeks with Maddy\'s proven method 💪',
            'https://www.fitnessbymaddy.com/#programs',
          ],
        });
        reengaged++;
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
