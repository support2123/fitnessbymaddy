const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { cors, maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge' });
    }

    const { data: recentMessages } = await supabase
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_7day')
      .gte('sent_at', sevenDaysAgo);

    const alreadyNudged = new Set((recentMessages || []).map(m => m.phone));

    let sent = 0;
    for (const lead of leads) {
      if (alreadyNudged.has(lead.phone)) continue;

      const isHinglish = lead.market === 'IN';
      const msg = isHinglish
        ? 'Hey! Maddy ka $20 trial abhi bhi available hai. Ek session se pata chal jayega.'
        : 'Hey! Maddy\'s $20 trial is still available. One session is all it takes.';

      await sendWhatsApp(lead.phone, 'reengagement_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      }, msg);

      sent++;
    }

    console.log(`[Cron/NudgeDropped] Re-engaged: ${sent}`);
    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('[Cron/NudgeDropped] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
