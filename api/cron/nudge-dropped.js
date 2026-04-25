const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const { data: msgCount } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgCount && msgCount.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const trialLink = 'https://www.fitnessbymaddy.com/intake.html?program=trial';

        const msg = market === 'IN'
          ? [lead.name || 'there', 'Maddy ke saath $20 trial session try karo!', trialLink]
          : [lead.name || 'there', 'Try a $20 trial session with Maddy!', trialLink];

        await sendWhatsApp(lead.phone, 'nudge_trial', msg);
        nudged++;
      }
    }

    const { data: dropLeads } = await db.from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (dropLeads) {
      for (const lead of dropLeads) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageSent } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (reEngageSent && reEngageSent.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const msg = market === 'IN'
          ? [lead.name || 'there', 'Abhi bhi interested ho? Maddy ke programs abhi available hain.']
          : [lead.name || 'there', 'Still interested? Maddy\'s programs are still available for you.'];

        await sendWhatsApp(lead.phone, 'reengage_7day', msg);
        reEngaged++;
      }
    }

    return res.json({ nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
