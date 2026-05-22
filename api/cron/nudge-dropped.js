const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    const { data: alreadyNudged } = await db
      .from('messages')
      .select('phone')
      .eq('template_name', 'nudge_reactivate')
      .gte('sent_at', sevenDaysAgo.toISOString());

    const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

    let nudged = 0;
    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const hinglish = isHinglish(lead.market || 'GLOBAL');
      await sendTemplate(lead.phone, 'nudge_reactivate', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      await db.from('leads').update({
        status: 'new',
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);

      nudged++;
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
