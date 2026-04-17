const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/mask');
const { isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (!count || count === 0) {
          const hinglish = isHinglishMarket(lead.market);
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            hinglish
              ? 'Ek baar try toh karo! Maddy ka $20 zoom trial — full session, no commitment. 💪'
              : 'Try a $20 Zoom trial with Maddy — full session, zero commitment. See the difference yourself! 💪'
          ]);
          nudged++;
          console.log(`Nudged: ${maskPhone(lead.phone)}`);
        }
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo)
      .lte('created_at', twentyFourHoursAgo);

    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time)
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString());

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (!count || count === 0) {
          const hinglish = isHinglishMarket(lead.market);
          await sendWhatsApp(lead.phone, 'reengage_7day', [
            hinglish
              ? 'Hey! Maddy ka special offer — limited spots available. Interested ho toh reply karo! 🔥'
              : 'Hey! Maddy has limited spots open this week. Still interested in transforming? Reply to grab yours! 🔥'
          ]);
          reEngaged++;
        }
      }
    }

    // Nudge clients who haven't submitted check-in (+24h and +48h)
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          const dayOfWeek = now.getDay();
          // Nudge on Monday (1 day after Sunday) and Tuesday (2 days after)
          if (dayOfWeek === 1 || dayOfWeek === 2) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
            await sendWhatsApp(client.phone, 'checkin_reminder', [
              client.name || 'there',
              checkinUrl
            ]);
            checkinNudged++;
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped, reEngaged, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
