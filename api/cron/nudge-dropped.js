const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');
const { detectMarket, getLanguage } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of leads) {
      const market = detectMarket(lead.phone);
      const lang = getLanguage(market);

      const templateName = lang === 'hinglish' ? 'nudge_trial_hi' : 'nudge_trial_en';
      const result = await sendTemplate(lead.phone, templateName, {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]
      });

      if (result.success) sent++;

      console.log(`Nudge ${result.success ? 'sent' : 'failed'}: ${maskPhone(lead.phone)}`);
    }

    const { error: dropError } = await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .in('status', ['new', 'qualified'])
      .lte('last_msg_at', fourteenDaysAgo);

    if (dropError) console.error('Drop stale leads error:', dropError.message);

    return res.status(200).json({
      success: true,
      leads_nudged: sent,
      total_eligible: leads.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
