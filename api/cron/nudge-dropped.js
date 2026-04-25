const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, sendText, canSend } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const results = { reengaged: 0, nudged_checkin: 0, skipped: 0 };

    // --- Part 1: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentOut } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentOut && recentOut.length > 0) {
          results.skipped++;
          continue;
        }

        const allowed = await canSend(lead.phone, false);
        if (!allowed) {
          results.skipped++;
          continue;
        }

        const market = lead.market || 'GLOBAL';
        const hinglish = isHinglish(market);
        const siteBase = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';

        if (hinglish) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            `${siteBase}/shred.html`
          ], lead.name);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [
            lead.name || 'there',
            `${siteBase}/shred.html`
          ], lead.name);
        }

        results.reengaged++;
      }
    }

    // --- Part 2: Nudge pending check-ins (+24h and +48h) ---
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const weeksSinceStart = Math.floor(
          (now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const { data: latestCheckin } = await db
          .from('checkins')
          .select('week_no, form_submitted_at')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        if (latestCheckin && latestCheckin.week_no >= weeksSinceStart) {
          continue;
        }

        const lastSunday = new Date(now);
        lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay());
        lastSunday.setHours(3, 30, 0, 0);

        const hoursSinceSunday = (now - lastSunday) / (60 * 60 * 1000);

        if (hoursSinceSunday < 24 || hoursSinceSunday > 72) {
          continue;
        }

        const allowed = await canSend(client.phone, true);
        if (!allowed) continue;

        const siteBase = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';
        const checkinUrl = `${siteBase}/checkin?c=${client.id}&w=${weeksSinceStart}`;
        const market = client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
        const hinglish = isHinglish(market);

        if (hoursSinceSunday >= 24 && hoursSinceSunday < 48) {
          if (hinglish) {
            await sendText(client.phone,
              `Hey ${client.name || 'there'}, check-in abhi bhi pending hai! 24 hrs ho gaye.\n\n` +
              `Jaldi submit karo: ${checkinUrl}\n\n` +
              `Consistency hi key hai!`
            );
          } else {
            await sendText(client.phone,
              `Hey ${client.name || 'there'}, your check-in is still pending!\n\n` +
              `Submit here: ${checkinUrl}\n\n` +
              `Consistency is key — don't skip this one!`
            );
          }
          results.nudged_checkin++;
        } else if (hoursSinceSunday >= 48) {
          if (hinglish) {
            await sendText(client.phone,
              `${client.name || 'Hey'}, final reminder! Check-in 48hrs se pending hai.\n\n` +
              `${checkinUrl}\n\n` +
              `Agar koi issue hai toh bata do, hum help karenge.`
            );
          } else {
            await sendText(client.phone,
              `${client.name || 'Hey'}, final reminder — your check-in has been pending for 48hrs.\n\n` +
              `${checkinUrl}\n\n` +
              `If something's off, let us know — we're here to help.`
            );
          }
          results.nudged_checkin++;
        }
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('[Cron NudgeDropped] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
