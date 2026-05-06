const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find leads that went silent 2+ hours ago but less than 24 hours
    // These are leads who received welcome but never replied
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stalledLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? ['Hey! 👋 Maddy ka $20 trial class try karo — full workout + nutrition guidance milega. Interested?\n\nhttps://www.fitnessbymaddy.com/program-trial.html']
          : ['Hey! 👋 Try Maddy\'s $20 trial class — full workout + nutrition guidance included. Interested?\n\nhttps://www.fitnessbymaddy.com/program-trial.html'];

        await sendTemplate(lead.phone, 'nudge_trial', msg);
        nudged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Mark leads as dropped if no activity in 24+ hours
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads (7-day rule: one final attempt)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? ['Last chance! Maddy ke programs abhi special rate pe available hain. Reply karo agar interested ho 💪']
          : ['Last chance! Maddy\'s programs are available at a special rate. Reply if interested 💪'];

        await sendTemplate(lead.phone, 'reengage_7day', msg);
        reengaged++;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
