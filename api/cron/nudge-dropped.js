const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone, isHinglishMarket } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads with no reply after 2 hours (still status=new)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', fourHoursAgo);

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const template = isHinglishMarket(lead.market) ? 'nudge_trial' : 'nudge_trial_en';
        await sendTemplate(lead.phone, template, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
      }
    }

    // Mark leads as dropped after 24 hours of no reply
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo);

    let dropped = 0;
    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule: one attempt after 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const template = isHinglishMarket(lead.market) ? 'reengage_7day' : 'reengage_7day_en';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        reEngaged++;
      }
    }

    // Check for clients with missed check-ins (nudge at +24h, +48h)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const sundayThisWeek = new Date(now);
        sundayThisWeek.setDate(now.getDate() - now.getDay());
        sundayThisWeek.setHours(3, 30, 0, 0);

        const hoursSinceSunday = (now - sundayThisWeek) / (1000 * 60 * 60);

        if ((hoursSinceSunday >= 24 && hoursSinceSunday < 26) ||
            (hoursSinceSunday >= 48 && hoursSinceSunday < 50)) {

          const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
            : 'https://fitnessbymaddy.com';

          const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl
          ]);
          clientNudges++;
        }

        const { count: consecutiveMissed } = await db
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 1);

        if (weekNo >= 2 && (consecutiveMissed || 0) === 0) {
          await notifyMaddy(
            `2 consecutive missed check-ins`,
            `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nWeek: ${weekNo}`
          );
        }
      }
    }

    console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${reEngaged} re-engaged, ${clientNudges} client nudges`);
    return res.status(200).json({ ok: true, nudged, dropped, reEngaged, clientNudges });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
