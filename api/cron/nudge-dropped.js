const { getSupabase } = require('../lib/supabase');
const { sendAndLog } = require('../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../lib/utils');

const SITE = 'https://www.fitnessbymaddy.com';
const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- Part 1: Nudge new leads that haven't replied (2hr + 24hr windows) ---

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', threeHoursAgo);

    let nudged = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hinglish = isHinglish(lead.market);
        const template = hinglish ? 'nudge_trial_hi' : 'nudge_trial';
        const trialLink = `${SITE}/shred.html`;

        await sendAndLog(lead.phone, template, [lead.name || 'there', trialLink]);
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // --- Part 2: Re-engage dropped leads (7-day rule, max 1 attempt) ---

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const hinglish = isHinglish(lead.market);
        const template = hinglish ? 'reengage_hi' : 'reengage';
        await sendAndLog(lead.phone, template, [lead.name || 'there']);
        reengaged++;
      }
    }

    // --- Part 3: Nudge clients who missed check-in (24hr + 48hr) ---

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;
    let consecutiveMissed = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

        const { data: thisWeek } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (thisWeek && thisWeek.length > 0) continue;

        const weekStartMs = startDate.getTime() + (weekNo - 1) * 7 * 24 * 60 * 60 * 1000;
        const hoursSinceWeekStart = (now.getTime() - weekStartMs) / (60 * 60 * 1000);

        if (hoursSinceWeekStart >= 24 && hoursSinceWeekStart < 48) {
          const checkinLink = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;
          await sendAndLog(client.phone, 'checkin_nudge_24h', [
            client.name || 'there', checkinLink,
          ], true);
          checkinNudged++;
        } else if (hoursSinceWeekStart >= 48 && hoursSinceWeekStart < 72) {
          const checkinLink = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;
          await sendAndLog(client.phone, 'checkin_nudge_48h', [
            client.name || 'there', checkinLink,
          ], true);
          checkinNudged++;
        }

        // Check for 2 consecutive missed check-ins → escalate
        const { data: lastTwo } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastCheckinWeek = lastTwo && lastTwo.length > 0 ? lastTwo[0].week_no : 0;
        if (weekNo - lastCheckinWeek >= 2) {
          await sendAndLog(
            MADDY_PHONE,
            'escalation_alert',
            [maskPhone(client.phone), `2 consecutive missed check-ins (week ${weekNo})`],
            true
          );
          consecutiveMissed++;
        }
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}, reengaged=${reengaged}, checkinNudged=${checkinNudged}`);
    return res.status(200).json({
      nudged, dropped, reengaged, checkinNudged, consecutiveMissed,
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
