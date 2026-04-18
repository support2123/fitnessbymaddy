const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudgeSent = 0;

    if (newLeadsNoReply) {
      for (const lead of newLeadsNoReply) {
        const hoursSinceCreated =
          (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreated >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          continue;
        }

        if (hoursSinceCreated >= 2 && hoursSinceCreated < 24) {
          const { data: msgs } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (!msgs || msgs.length === 0) {
            await sendWhatsApp(lead.phone, 'nudge_trial', [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html',
            ]);
            nudgeSent++;
          }
        }
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', thirtyDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentNudge } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7d')
          .limit(1);

        if (!recentNudge || recentNudge.length === 0) {
          const market = detectMarket(lead.phone);
          await sendWhatsApp(
            lead.phone,
            isHinglish(market) ? 'reengage_7d_hi' : 'reengage_7d_en',
            [lead.name || 'there']
          );
          reEngaged++;
        }
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24 * 7));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const lastSunday = new Date(now);
          lastSunday.setDate(now.getDate() - now.getDay());
          lastSunday.setHours(3, 30, 0, 0);

          const hoursSinceSunday = (now - lastSunday) / (1000 * 60 * 60);

          if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
            await sendWhatsApp(client.phone, 'checkin_nudge_24h', [
              client.name || 'there',
              `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`,
            ]);
            checkinNudges++;
          } else if (hoursSinceSunday >= 48 && hoursSinceSunday < 72) {
            await sendWhatsApp(client.phone, 'checkin_nudge_48h', [
              client.name || 'there',
              `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`,
            ]);
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      action: 'daily_nudges',
      nudge_sent: nudgeSent,
      re_engaged: reEngaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
