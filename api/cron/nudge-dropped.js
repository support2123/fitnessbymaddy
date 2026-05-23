const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const market = detectMarket(lead.phone);
        const msg = market === 'IN'
          ? `Hey! 👋 Maddy ka $20 trial session available hai — 1 live Zoom class + assessment. Interested?\n\nhttps://fitnessbymaddy.com/program-trial.html`
          : `Hey! 👋 Maddy's $20 trial session is available — 1 live Zoom class + assessment. Interested?\n\nhttps://fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: [lead.name || 'there']
        });
        nudged++;
      }
    }

    const { data: missedCheckins } = await supabase
      .from('clients')
      .select('*, checkins(week_no)')
      .eq('status', 'active');

    let escalations = 0;
    if (missedCheckins) {
      for (const client of missedCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const currentWeek = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24 * 7));
        const completedWeeks = (client.checkins || []).map(c => c.week_no);

        let consecutive = 0;
        for (let w = currentWeek; w > 0 && w > currentWeek - 3; w--) {
          if (!completedWeeks.includes(w)) consecutive++;
          else break;
        }

        if (consecutive >= 2) {
          await notifyMaddy(`2+ missed check-ins: ${client.name || 'Client'} (${client.program}). May need outreach.`);
          escalations++;
        }
      }
    }

    return res.status(200).json({ success: true, nudged, escalations });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
