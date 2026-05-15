const supabase = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Re-engage leads that went silent (status=new, last msg 2-24hrs ago)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads that haven't replied in 2hrs
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        if (isHinglish(lead.market)) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
        }
        nudged++;
      }
    }

    // Drop leads that haven't replied in 24hrs
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Nudge clients who haven't submitted check-in (+24hrs, +48hrs)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const isSunday = new Date().getDay() === 0;
    const isMonday = new Date().getDay() === 1;
    const isTuesday = new Date().getDay() === 2;

    let checkinNudged = 0;
    if (isMonday || isTuesday) {
      const { data: activeClients } = await supabase
        .from('clients')
        .select('*')
        .eq('status', 'active');

      if (activeClients) {
        for (const client of activeClients) {
          const weekNo = calculateWeekNo(client.program_started_at);
          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();

          if (!checkin) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              checkinUrl
            ]);
            checkinNudged++;
          }
        }
      }
    }

    return res.json({ action: 'nudge_complete', nudged, dropped, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}
