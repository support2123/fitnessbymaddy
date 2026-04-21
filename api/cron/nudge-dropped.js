const { getSupabase } = require('../_lib/supabase');
const { sendTextMessage, sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone, jsonResponse, errorResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  const db = getSupabase();
  const results = { lead_nudges: 0, checkin_nudges: 0, escalations: 0, errors: 0 };

  try {
    // --- PART 1: Nudge new leads who haven't replied ---
    await nudgeNewLeads(db, results);

    // --- PART 2: Nudge clients who haven't submitted check-ins ---
    await nudgeMissedCheckins(db, results);

    // --- PART 3: Re-engage dropped leads (7-day rule) ---
    await reengageDropped(db, results);

    return jsonResponse(res, { message: 'Nudge cron complete', results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

async function nudgeNewLeads(db, results) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Leads who got welcome msg 2+ hours ago but haven't replied
  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  for (const lead of staleLeads || []) {
    try {
      const { data: nudged } = await db
        .from('nudge_log')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('nudge_type', 'trial_2hr')
        .single();

      if (nudged) continue;

      const market = detectMarket(lead.phone);
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      const msg = isHinglish(market)
        ? `Hey ${lead.name || 'there'}! 👋\n\n` +
          `Abhi tak decide nahi hua? Koi baat nahi — pehle $20 ka trial try karo:\n` +
          `➡️ ${trialUrl}\n\n` +
          `Ek Zoom session mein pata chal jayega ki program kaise kaam karta hai!`
        : `Hey ${lead.name || 'there'}! 👋\n\n` +
          `Still thinking? No pressure — try a $20 trial session first:\n` +
          `➡️ ${trialUrl}\n\n` +
          `One Zoom session to see exactly how the program works!`;

      await sendTextMessage(lead.phone, msg);
      await db.from('nudge_log').insert({ lead_id: lead.id, nudge_type: 'trial_2hr' });
      results.lead_nudges++;
    } catch (err) {
      console.error(`Nudge failed for lead ${maskPhone(lead.phone)}:`, err.message);
      results.errors++;
    }
  }

  // Drop leads who haven't replied in 24 hours
  const { data: deadLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of deadLeads || []) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
  }
}

async function nudgeMissedCheckins(db, results) {
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  for (const client of activeClients || []) {
    try {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay(); // 0=Sun

      // +24hr nudge (Monday after Sunday send)
      if (dayOfWeek === 1) {
        const { data: nudged } = await db
          .from('nudge_log')
          .select('id')
          .eq('lead_id', client.lead_id || client.id)
          .eq('nudge_type', `checkin_nudge1_w${currentWeek}`)
          .single();

        if (!nudged) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          const market = detectMarket(client.phone);

          const msg = isHinglish(market)
            ? `Reminder: Week ${currentWeek} check-in abhi bhi pending hai! 📋\n\n➡️ ${checkinUrl}`
            : `Reminder: Your Week ${currentWeek} check-in is still pending! 📋\n\n➡️ ${checkinUrl}`;

          await sendTextMessage(client.phone, msg);
          await db.from('nudge_log').insert({
            lead_id: client.lead_id || client.id,
            nudge_type: `checkin_nudge1_w${currentWeek}`
          });
          results.checkin_nudges++;
        }
      }

      // +48hr nudge (Tuesday)
      if (dayOfWeek === 2) {
        const { data: nudged } = await db
          .from('nudge_log')
          .select('id')
          .eq('lead_id', client.lead_id || client.id)
          .eq('nudge_type', `checkin_nudge2_w${currentWeek}`)
          .single();

        if (!nudged) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          await sendTextMessage(client.phone,
            `Last reminder for Week ${currentWeek} check-in! Without it, we can't optimize your program.\n\n➡️ ${checkinUrl}`
          );
          await db.from('nudge_log').insert({
            lead_id: client.lead_id || client.id,
            nudge_type: `checkin_nudge2_w${currentWeek}`
          });
          results.checkin_nudges++;
        }
      }

      // 2 consecutive missed check-ins → escalate
      if (currentWeek >= 2) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek - 1)
          .single();

        if (!prevCheckin && !checkin) {
          const { data: escalated } = await db
            .from('escalations')
            .select('id')
            .eq('phone', client.phone)
            .eq('reason', 'missed_checkins')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .single();

          if (!escalated) {
            await db.from('escalations').insert({
              phone: client.phone,
              reason: 'missed_checkins',
              message_body: `2 consecutive missed check-ins (weeks ${currentWeek - 1} and ${currentWeek})`
            });
            await notifyMaddy('2 missed check-ins',
              `Client: ${maskPhone(client.phone)} (${client.name})\nWeeks ${currentWeek - 1} & ${currentWeek} missed`
            );
            results.escalations++;
          }
        }
      }
    } catch (err) {
      console.error(`Checkin nudge failed for ${maskPhone(client.phone)}:`, err.message);
      results.errors++;
    }
  }
}

async function reengageDropped(db, results) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', fourteenDaysAgo);

  for (const lead of droppedLeads || []) {
    try {
      const { data: nudged } = await db
        .from('nudge_log')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('nudge_type', 'reengage_7d')
        .single();

      if (nudged) continue;

      const market = detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? `Hey ${lead.name || 'there'}! 🙋\n\n` +
          `Agar abhi bhi fitness goals pe kaam karna hai toh baat karo — ` +
          `hum sahi program suggest karenge. No pressure!`
        : `Hey ${lead.name || 'there'}! 🙋\n\n` +
          `If you're still thinking about your fitness goals, just reply — ` +
          `we'll help find the right program for you. No pressure!`;

      await sendTextMessage(lead.phone, msg);
      await db.from('nudge_log').insert({ lead_id: lead.id, nudge_type: 'reengage_7d' });
      results.lead_nudges++;
    } catch (err) {
      console.error(`Reengage failed for ${maskPhone(lead.phone)}:`, err.message);
      results.errors++;
    }
  }
}
