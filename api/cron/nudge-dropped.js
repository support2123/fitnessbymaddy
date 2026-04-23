const { supabase } = require('../../lib/supabase');
const { sendText } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: reEngageLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (error) {
      console.error('Fetch dropped leads error:', error.message);
      return res.status(500).json({ error: 'db error' });
    }

    let nudged = 0;

    for (const lead of reEngageLeads || []) {
      const { data: msgCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo.toISOString());

      if (msgCount && msgCount.length > 0) continue;

      const msg = lead.market === 'IN'
        ? `Hey ${lead.name || ''}! 👋 Maddy ka $20 trial abhi bhi available hai — ek baar try karo, results khud dekhoge. Interested?`
        : `Hey ${lead.name || ''}! 👋 Maddy's $20 trial is still available — try it once and see the results for yourself. Interested?`;

      await sendText(lead.phone, msg.trim());
      nudged++;
    }

    return res.json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
