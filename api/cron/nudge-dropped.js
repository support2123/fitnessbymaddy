const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo.toISOString())
      .gt('created_at', sevenDaysAgo.toISOString());

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of leads) {
      try {
        const { data: msgs } = await db
          .from('messages')
          .select('id, template_name')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) {
          results.skipped++;
          continue;
        }

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: hinglish
            ? [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
            : [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html'],
        });

        results.nudged++;

      } catch (err) {
        console.error('Nudge error:', err.message);
        results.errors++;
      }
    }

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);

    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo.toISOString())
      .lt('created_at', twentyFourHoursAgo.toISOString());

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed', results });
  }
};
