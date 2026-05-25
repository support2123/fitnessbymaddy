const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { getLanguage } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads that went quiet 2-7 days ago (haven't replied)
    const { data: stalledLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('last_msg_at', sevenDaysAgo);

    let nudged = 0;

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        const lang = getLanguage(lead.market);
        if (lang === 'hinglish') {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ]);
        }

        nudged++;
      }
    }

    // Auto-drop leads older than 7 days with no conversion
    const { data: oldLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo);

    let dropped = 0;
    if (oldLeads) {
      for (const lead of oldLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Nudge active clients who haven't submitted weekly check-in (+24hrs, +48hrs)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const weeksElapsed = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        if (weeksElapsed < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksElapsed)
          .single();

        if (checkin) continue;

        const allowed = await canSendMessage(client.phone, true);
        if (!allowed) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl,
        ]);

        clientNudged++;
      }
    }

    return res.status(200).json({ nudged, dropped, clientNudged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
