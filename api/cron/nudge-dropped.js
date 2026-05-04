const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;
    let dropped = 0;

    // --- Phase 1: 2-hour nudge for new leads with no reply ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, phone, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString());

    if (newLeads) {
      for (const lead of newLeads) {
        // Check if we already sent a nudge (look at outbound messages count)
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out');

        // Only nudge if we've sent exactly 1 message (the welcome)
        if (count === 1) {
          const canSend = await canSendToLead(lead.phone);
          if (canSend) {
            const trialUrl = 'https://fitnessbymaddy.com/intake.html?program=trial';
            if (isHinglish(lead.market)) {
              await sendTemplate(lead.phone, 'nudge_trial_hi', [trialUrl]);
            } else {
              await sendTemplate(lead.phone, 'nudge_trial_en', [trialUrl]);
            }
            nudged++;
          }
        }
      }
    }

    // --- Phase 2: Drop leads with no reply after 24 hours ---
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo.toISOString());

    if (staleLeads) {
      for (const lead of staleLeads) {
        // Check if lead ever replied (any inbound after first outbound)
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', twentyFourHoursAgo.toISOString())
          .limit(1);

        if (!replies || replies.length === 0) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // --- Phase 3: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    let reengaged = 0;

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('id, phone, market, program_interest')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const canSend = await canSendToLead(lead.phone);
        if (canSend) {
          if (isHinglish(lead.market)) {
            await sendTemplate(lead.phone, 'reengage_7day_hi', []);
          } else {
            await sendTemplate(lead.phone, 'reengage_7day_en', []);
          }
          reengaged++;
        }
      }
    }

    // --- Phase 4: Nudge clients with pending check-ins (+24h, +48h) ---
    let clientNudges = 0;
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil(
          (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          const canSend = await canSendToLead(client.phone);
          if (canSend) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              checkinUrl
            ]);
            clientNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reengaged,
      clientNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
