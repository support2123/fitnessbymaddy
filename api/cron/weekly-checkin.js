const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let sent = 0;
    let errors = 0;

    for (const client of (activeClients || [])) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || 'Champion',
          templateParams: [
            `Week ${weekNo} check-in time! Fill this quick form so we can track your progress and adjust your plan: ${checkinUrl}`
          ]
        }, true);

        sent++;
      } catch (err) {
        errors++;
        console.error(`Checkin send failed for client ${client.id}:`, err.message);
      }
    }

    // Handle 2-hour nudges for leads
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .is('program_interest', null);

    for (const lead of (staleLeads || [])) {
      const trialUrl = 'https://www.fitnessbymaddy.com/program-trial.html';
      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          `Hey! Still thinking? Try Maddy's $20 trial session first — zero risk, full value: ${trialUrl}`
        ]
      }, false).catch(() => {});
    }

    return res.json({ success: true, checkins_sent: sent, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}
