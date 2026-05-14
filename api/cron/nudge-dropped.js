const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, isRateLimited } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { maskPhone } = require('../../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      try {
        const limited = await isRateLimited(lead.phone);
        if (limited) continue;

        const hinglish = isHinglish(lead.market);

        const message = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy's team se — abhi bhi fitness goals pe kaam karna hai? 💪\n\nHamara $20 zoom trial try karo — no commitment, sirf 1 session.\n\nReply "TRIAL" to get started!`
          : `Hey ${lead.name || 'there'}! It's Maddy's team — still thinking about your fitness goals? 💪\n\nTry our $20 zoom trial — no commitment, just 1 session.\n\nReply "TRIAL" to get started!`;

        await sendWhatsApp(lead.phone, message, 'nudge_reengagement');

        await supabase.from('leads')
          .update({ last_msg_at: new Date().toISOString() })
          .eq('id', lead.id);

        nudged++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    // Also nudge check-in reminders (+24hrs, +48hrs)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const limited = await isRateLimited(client.phone);
        if (limited) continue;

        const hinglish = isHinglish(client.leads?.market);
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const message = hinglish
          ? `Reminder! 📊 Week ${weekNo} check-in abhi tak pending hai.\n\n${checkinUrl}\n\nProgress track karna zaroori hai! 💪`
          : `Reminder! 📊 Your Week ${weekNo} check-in is still pending.\n\n${checkinUrl}\n\nTracking progress is key! 💪`;

        await sendWhatsApp(client.phone, message, 'checkin_nudge');
        checkinNudges++;
      }
    }

    return res.status(200).json({ nudged, checkinNudges });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
