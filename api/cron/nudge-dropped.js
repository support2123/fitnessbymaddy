const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (!staleLeads || staleLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of staleLeads) {
      const market = lead.market || 'IN';
      const params = market === 'IN'
        ? [`Hey ${lead.name || 'there'}! Maddy ke $20 trial class mein spot available hai — live Zoom session with full guidance.\n\nInterested? Reply "trial" 👇`]
        : [`Hey ${lead.name || 'there'}! A spot just opened for Maddy's $20 trial class — live Zoom session with full guidance.\n\nInterested? Reply "trial" 👇`];

      await sendWhatsApp(lead.phone, 'nudge_trial', params);
      nudged++;

      await new Promise(r => setTimeout(r, 500));
    }

    return res.status(200).json({ nudged, total_stale: staleLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
