const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNeedingNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    for (const lead of (newLeadsNeedingNudge || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (msgs?.length > 0) continue;

      const hoursSinceCreated = (now.getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);
      const hinglish = isHinglishMarket(lead.market);

      if (hoursSinceCreated >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        continue;
      }

      if (hoursSinceCreated >= 2) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count > 0) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: hinglish
            ? `Hey! 👋 Maddy ka $20 trial session try karna chahoge? Ek Zoom call mein pura plan milega.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nKoi bhi sawaal ho toh pooch lo!`
            : `Hey! 👋 Want to try Maddy's $20 trial session? Get a full plan in one Zoom call.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nFeel free to ask any questions!`,
          params: {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there']
          }
        });
        nudged++;
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    let reEngaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 're_engage');

      if (count > 0) continue;

      const hinglish = isHinglishMarket(lead.market);
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 're_engage',
        body: hinglish
          ? `Hey ${lead.name || 'there'}! 💪 Abhi bhi fitness goals pe kaam karna hai? Maddy ke programs mein limited spots hain. Ek baar try karo — sirf $20 ka trial session.\n\nhttps://fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || 'there'}! 💪 Still thinking about your fitness goals? Spots in Maddy's programs are limited. Try it once — just $20 for a trial session.\n\nhttps://fitnessbymaddy.com/program-trial.html`,
        params: {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        }
      });
      reEngaged++;
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      dropped,
      reEngaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
