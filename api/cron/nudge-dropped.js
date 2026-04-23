const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase()
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await supabase().from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceLastMsg >= 2 && await canSendMessage(lead.phone, false)) {
          const market = detectMarket(lead.phone);
          const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendTemplate(lead.phone, templateName, [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ]);
          nudged++;
        }
      }
    }

    const { data: qualifiedLeads } = await supabase()
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .gt('created_at', sevenDaysAgo);

    if (qualifiedLeads) {
      for (const lead of qualifiedLeads) {
        if (await canSendMessage(lead.phone, false)) {
          await sendTemplate(lead.phone, 'qualified_reminder', [
            lead.name || 'there',
            lead.program_interest || 'your program',
          ]);
          nudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
