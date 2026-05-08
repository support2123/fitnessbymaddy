const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

const NUDGE_WINDOW_DAYS = 7;
const TRIAL_URL = 'https://fitnessbymaddy.com/shred.html';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) {
      console.error('Fetch dropped leads error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    let nudged = 0;

    for (const lead of leads || []) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const isIN = lead.market === 'IN';
      const msg = isIN
        ? `Hey ${lead.name || ''}! Maddy ka $20 trial abhi bhi available hai. Ek baar try karo, results khud dekhoge: ${TRIAL_URL}`
        : `Hey ${lead.name || ''}! Maddy's trial is still available. Give it a try and see results for yourself: ${TRIAL_URL}`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_reengagement',
        body: msg,
        isClient: false
      });

      if (result.success) nudged++;
    }

    return res.status(200).json({
      success: true,
      leads_checked: (leads || []).length,
      nudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
