const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendTo } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('id, phone, name, program_interest, market')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    let nudged = 0;

    for (const lead of leads) {
      const allowed = await canSendTo(lead.phone);
      if (!allowed) continue;

      const isIN = lead.market === 'IN';
      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        isIN ? '₹1,650' : '$20',
      ]);

      nudged++;
    }

    return res.status(200).json({ success: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
