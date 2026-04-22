const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_new: 0, nudged_qualified: 0, errors: 0 };

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads (no reply in 2+ hrs, created < 24 hrs ago)
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          const { data: msgs } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (msgs && msgs.length > 0) continue;

          const hinglish = isHinglish(lead.market);
          const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

          const body = hinglish
            ? `Hey! 👋 Abhi tak confused ho? Ek kaam karo — $20 ka trial session try karo, zero risk.\n\n` +
              `🔗 ${trialUrl}\n\n` +
              `Ek session ke baad decide karna — trust the process!`
            : `Hey! 👋 Still thinking? Try a $20 trial session — zero risk, real results.\n\n` +
              `🔗 ${trialUrl}\n\n` +
              `One session to decide — trust the process!`;

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            bodyValues: [body],
          });

          results.nudged_new++;
        } catch (e) {
          results.errors++;
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    // Re-engage dropped leads (7-day rule: only once, 7 days after drop)
    const sevenDaysWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysWindow.toISOString())
      .gte('last_msg_at', eightDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        try {
          const { data: reengageMsg } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengage_7day')
            .limit(1);

          if (reengageMsg && reengageMsg.length > 0) continue;

          const hinglish = isHinglish(lead.market);
          const body = hinglish
            ? `Hey! 🙌 Maddy ki team se — kuch naya try karna hai toh batao. Tumhare goals ke liye personalized plan ready hai!`
            : `Hey! 🙌 From Maddy's team — if you're ready to try something new, let us know. A personalized plan is waiting for your goals!`;

          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'reengage_7day',
            bodyValues: [body],
          });

          results.nudged_qualified++;
        } catch (e) {
          results.errors++;
        }
      }
    }

    return res.json({ message: 'Nudge cron complete', results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
