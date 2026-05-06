const { getSupabase } = require('../_lib/supabase');
const { sendText, notifyMaddy } = require('../_lib/whatsapp');
const { weeksBetween, detectMarket, maskPhone, jsonResponse, errorResponse } = require('../_lib/helpers');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse(res, 'Unauthorized', 401);
  }

  const db = getSupabase();
  const now = new Date();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('id, phone, name, program, program_started_at, program_ends_at')
    .eq('status', 'active');

  if (error) {
    console.error('[Cron] Failed to fetch clients:', error.message);
    return errorResponse(res, 'Database error', 500);
  }

  let sent = 0;
  let nudged = 0;
  let escalated = 0;

  for (const client of clients || []) {
    // Skip if program ended
    if (client.program_ends_at && new Date(client.program_ends_at) < now) {
      await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
      continue;
    }

    const weekNo = weeksBetween(client.program_started_at, now);
    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';

    // Check if this week's check-in was already submitted
    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id, form_submitted_at')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (existingCheckin) {
      // Already submitted this week
      continue;
    }

    // Check if we already sent a check-in link this week
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // Check for missed check-ins (last week not submitted)
    if (weekNo > 1) {
      const { data: lastWeekCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo - 1)
        .limit(1)
        .single();

      if (!lastWeekCheckin) {
        // Check if week before that was also missed
        const { data: twoWeeksAgo } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 2)
          .limit(1)
          .single();

        if (!twoWeeksAgo && weekNo > 2) {
          // 2 consecutive missed check-ins → escalate
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nWeeks missed: ${weekNo - 2}, ${weekNo - 1}`
          );
          await db.from('escalations').insert({
            phone: client.phone,
            client_id: client.id,
            reason: 'two_missed_checkins'
          });
          escalated++;
        }

        // Send nudge for last week
        const nudgeMsg = isHinglish
          ? `Hey ${client.name}! Last week ka check-in miss ho gaya. Koi baat nahi — is week ka form yahan hai 👇\n\n${SITE}/checkin?c=${client.id}&w=${weekNo}`
          : `Hey ${client.name}! Looks like you missed last week's check-in. No worries — here's this week's form 👇\n\n${SITE}/checkin?c=${client.id}&w=${weekNo}`;
        await sendText(client.phone, nudgeMsg);
        nudged++;
        continue;
      }
    }

    // Send check-in form link
    const checkinUrl = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;
    const msg = isHinglish
      ? `Good morning ${client.name}! ☀️ Week ${weekNo} check-in time!\n\nWeight, measurements, aur photos update kar:\n${checkinUrl}\n\nYeh data tere next week ke plan ko better banata hai 💪`
      : `Good morning ${client.name}! ☀️ Time for your Week ${weekNo} check-in!\n\nUpdate your weight, measurements, and photos:\n${checkinUrl}\n\nThis data helps us optimize your next week's plan 💪`;

    await sendText(client.phone, msg);
    sent++;
  }

  console.log(`[Cron] Weekly check-in: ${sent} sent, ${nudged} nudged, ${escalated} escalated`);

  return jsonResponse(res, {
    ok: true,
    sent,
    nudged,
    escalated,
    total_clients: clients?.length || 0
  });
};
