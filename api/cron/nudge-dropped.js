const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sb = getSupabase();
    const now = new Date();

    // Flow A step 3: nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
          const market = detectMarket(lead.phone);
          const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';
          await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
          nudged++;
        }

        if (hoursSinceMsg >= 24) {
          await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
      }
    }

    // Re-engage dropped leads once after 7 days (only if not opted out)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'reengage_7day_hi' : 'reengage_7day';
        await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted weekly check-in
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sundayIST = getSundayIST();

    if (sundayIST) {
      const { data: activeClients } = await sb
        .from('clients')
        .select('*')
        .eq('status', 'active');

      let checkinNudged = 0;

      if (activeClients) {
        for (const client of activeClients) {
          const startDate = new Date(client.program_started_at);
          const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
          const currentWeek = Math.ceil(daysSinceStart / 7);

          const { data: checkin } = await sb
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .single();

          if (!checkin) {
            const hoursSinceSunday = (now - sundayIST) / (1000 * 60 * 60);
            if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
              const market = detectMarket(client.phone);
              const templateName = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge';
              const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
              await sendTemplate(client.phone, templateName, [
                client.name || 'there',
                String(currentWeek),
                checkinUrl
              ]);
              checkinNudged++;
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true, nudged, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function getSundayIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const day = ist.getUTCDay();
  if (day < 0) return null;
  const daysSinceSunday = day;
  const sunday = new Date(ist);
  sunday.setUTCDate(sunday.getUTCDate() - daysSinceSunday);
  sunday.setUTCHours(3, 30, 0, 0); // 9am IST = 3:30am UTC
  return new Date(sunday.getTime() - istOffset);
}
