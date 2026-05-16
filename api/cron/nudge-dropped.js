const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', count: 0 });
    }

    const { data: recentNudges } = await supabase
      .from('messages')
      .select('phone')
      .eq('direction', 'out')
      .eq('template_name', 'reengagement_7d')
      .gte('sent_at', sevenDaysAgo.toISOString());

    const nudgedPhones = new Set((recentNudges || []).map(m => m.phone));
    let sent = 0;

    for (const lead of droppedLeads) {
      if (nudgedPhones.has(lead.phone)) continue;

      const isIN = lead.market === 'IN';
      const msg = isIN
        ? `Hey ${lead.name || 'there'}! 👋 Maddy's $20 trial zoom session abhi bhi available hai — 45 min personalised coaching. Interested? Reply "trial" to book!`
        : `Hey ${lead.name || 'there'}! 👋 Maddy's $20 trial zoom session is still available — 45 min of personalised coaching. Reply "trial" to book!`;

      await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'reengagement_7d' });
      sent++;
    }

    return res.status(200).json({ sent, total: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
