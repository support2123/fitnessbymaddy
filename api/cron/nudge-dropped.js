const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pendingNudges } = await supabase
      .from('clients')
      .select('id, phone, name, lead_id')
      .eq('status', 'active')
      .not('id', 'in', await getPendingCheckinClientIds(supabase));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', twoDaysAgo);

    let reEngaged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

        if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
          const hinglish = isHinglish(lead.market);
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            body: hinglish
              ? `Hey! 👋 Abhi bhi soch rahe ho? Maddy ka $20 trial session try karo — risk-free.\n\nhttps://fitnessbymaddy.com/program-trial.html`
              : `Hey! 👋 Still thinking? Try Maddy's $20 trial session — completely risk-free.\n\nhttps://fitnessbymaddy.com/program-trial.html`,
            params: []
          });
          reEngaged++;
        } else if (hoursSinceLastMsg >= 24) {
          await supabase.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
        }
      }
    }

    let checkinNudged = 0;
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at, lead_id')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const weeksElapsed = Math.floor(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        const currentWeek = weeksElapsed + 1;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const { data: lastMsg } = await supabase
          .from('messages')
          .select('sent_at, template_name')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastMsg) continue;

        const hoursSinceNudge = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (60 * 60 * 1000);

        if (hoursSinceNudge >= 24 && hoursSinceNudge < 48) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendWhatsApp({
            phone: client.phone,
            templateName: 'checkin_reminder',
            body: `Reminder: your Week ${currentWeek} check-in is still pending! 📋\n\n${checkinUrl}`,
            params: [String(currentWeek), checkinUrl]
          });
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({ ok: true, reEngaged, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getPendingCheckinClientIds(supabase) {
  const { data } = await supabase
    .from('checkins')
    .select('client_id')
    .gte('form_submitted_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (!data) return '()';
  return `(${data.map(c => `'${c.client_id}'`).join(',')})`;
}
