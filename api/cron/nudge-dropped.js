const { supabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../lib/whatsapp');
const { detectMarket, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();

    // PART 1: Re-engage dropped leads (7-day rule — only nudge once if dropped 7 days ago)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const eightDaysAgo = new Date(now);
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (count > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const message = market === 'IN'
          ? `Hey ${lead.name || 'there'}! Maddy ki team se 👋\n\nAapka fitness goal abhi bhi wait kar raha hai. $20 trial se start karo — koi commitment nahi:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply karo agar koi question hai!`
          : `Hey ${lead.name || 'there'}! Maddy's team here 👋\n\nYour fitness goal is still waiting. Start with our $20 trial — no commitment:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply if you have any questions!`;

        await sendWhatsApp(lead.phone, message, 'reengage_7day');
        reengaged++;
      }
    }

    // PART 2: Nudge check-in reminders (+24hrs and +48hrs after Sunday send)
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let nudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

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
          .in('template_name', ['weekly_checkin', 'checkin_nudge_24h', 'checkin_nudge_48h'])
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastMsg) continue;

        const lastSentAt = new Date(lastMsg.sent_at);
        const hoursSince = (now - lastSentAt) / (60 * 60 * 1000);

        let templateToSend = null;
        if (hoursSince >= 48 && lastMsg.template_name === 'checkin_nudge_24h') {
          templateToSend = 'checkin_nudge_48h';
        } else if (hoursSince >= 24 && lastMsg.template_name === 'weekly_checkin') {
          templateToSend = 'checkin_nudge_24h';
        }

        if (templateToSend) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          const market = detectMarket(client.phone);

          const message = market === 'IN'
            ? `Reminder: Week ${currentWeek} check-in abhi tak pending hai 📋\n\n${checkinUrl}\n\n2 min lagega — aapka progress track karna zaroori hai!`
            : `Reminder: Your Week ${currentWeek} check-in is still pending 📋\n\n${checkinUrl}\n\nTakes 2 minutes — tracking progress matters!`;

          await sendWhatsApp(client.phone, message, templateToSend);
          nudged++;
        }
      }
    }

    // PART 3: Flag clients with 2+ consecutive missed check-ins
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        if (currentWeek < 3) continue;

        const { count } = await supabase
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 1);

        if (count === 0) {
          await sendEscalation(
            `MISSED CHECK-INS: ${client.name || maskPhone(client.phone)} has missed 2+ consecutive check-ins (current week: ${currentWeek}). May need personal outreach.`
          );
        }
      }
    }

    return res.status(200).json({
      reengaged_leads: reengaged,
      checkin_nudges: nudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
