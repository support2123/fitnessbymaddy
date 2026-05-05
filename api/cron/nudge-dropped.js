const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let nudgesSent = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        } else if (hoursSinceLastMsg >= 2) {
          const market = lead.market || detectMarket(lead.phone);
          if (market === 'IN') {
            await sendTemplate(lead.phone, 'nudge_trial_hindi', [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html'
            ]);
          } else {
            await sendTemplate(lead.phone, 'nudge_trial', [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html'
            ]);
          }
          nudgesSent++;
        }
      }
    }

    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .lt('last_msg_at', sevenDaysAgo);

    if (qualifiedLeads) {
      for (const lead of qualifiedLeads) {
        await sendTemplate(lead.phone, 'followup_qualified', [
          lead.name || 'there'
        ]);
        nudgesSent++;
      }
    }

    return res.status(200).json({
      success: true,
      nudges_sent: nudgesSent,
      dropped
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
