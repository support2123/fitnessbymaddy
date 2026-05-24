const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      if (!(await canSendMessage(lead.phone))) continue;

      const params = lead.market === 'IN'
        ? ['Hey! Maddy ki team se. Abhi bhi interested ho fitness journey mein? Ek $20 trial se start karo — no commitment.']
        : ['Hey! Still thinking about starting your fitness journey? Try a $20 trial session first — no commitment.'];

      await sendWhatsApp(lead.phone, 'nudge_trial', params);
      nudged++;
    }

    return res.status(200).json({ message: 'Nudge cron complete', nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
