const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { re_engaged: 0, skipped: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to re-engage', results });
    }

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) {
        results.skipped++;
        continue;
      }

      const { data: optOut } = await db
        .from('messages')
        .select('body')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (optOut?.[0]?.body) {
        const lastMsg = optOut[0].body.toLowerCase().trim();
        if (lastMsg === 'stop' || lastMsg === 'unsubscribe') {
          results.skipped++;
          continue;
        }
      }

      const hinglish = isHinglish(lead.market);
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ],
      });

      results.re_engaged++;
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('nudge-dropped cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
