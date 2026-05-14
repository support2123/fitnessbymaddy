import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket, jsonResponse } from '../../lib/utils.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    // Nudge leads that went silent for 2 hours (new leads only)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Flow A step 3: Nudge new leads after 2 hours of no reply
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', oneDayAgo);

    let nudged = 0;
    if (silentLeads) {
      for (const lead of silentLeads) {
        const { data: outMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (outMessages && outMessages.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey! 👋 Maddy ka $20 trial session try karke dekho — poora personalized hota hai.\n\n` +
            `🔗 https://www.fitnessbymaddy.com/checkout/zoom_trial\n\n` +
            `Bas ek session mein samajh aa jayega!`
          : `Hey! 👋 Try Maddy's $20 trial session — fully personalized for you.\n\n` +
            `🔗 https://www.fitnessbymaddy.com/checkout/zoom_trial\n\n` +
            `One session is all it takes to see the difference!`;

        await sendTemplate(lead.phone, 'nudge_trial', [msg]);
        nudged++;
      }
    }

    // Flow A step 4: Drop leads with no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo)
      .gt('created_at', sevenDaysAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Nudge active clients who missed check-ins (24h and 48h reminders)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateCurrentWeek(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        const daysSinceWeekStart = getDaysSinceWeekStart(client.program_started_at, weekNo);
        if (daysSinceWeekStart >= 1 && daysSinceWeekStart <= 3) {
          const market = detectMarket(client.phone);
          const hinglish = isHinglish(market);

          const msg = hinglish
            ? `Reminder: Week ${weekNo} ka check-in abhi tak pending hai! 📋\n\n` +
              `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`
            : `Reminder: Your Week ${weekNo} check-in is still pending! 📋\n\n` +
              `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

          await sendTemplate(client.phone, 'checkin_reminder', [msg]);
          clientNudged++;
        }

        // Escalate if 2 consecutive missed check-ins
        if (weekNo >= 2) {
          const { data: prevCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .maybeSingle();

          if (!prevCheckin && !checkin) {
            const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
            await sendTemplate(MADDY_PHONE, 'escalation_alert', [
              `⚠️ 2 MISSED CHECK-INS\nClient: ${client.name || client.phone}\nWeeks ${weekNo - 1} & ${weekNo} — needs follow-up.`,
            ]);
          }
        }
      }
    }

    return jsonResponse(res, 200, { ok: true, nudged, dropped, clientNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}

function calculateCurrentWeek(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  return Math.ceil((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function getDaysSinceWeekStart(programStart, weekNo) {
  const start = new Date(programStart);
  const weekStartMs = start.getTime() + (weekNo - 1) * 7 * 24 * 60 * 60 * 1000;
  return (Date.now() - weekStartMs) / (24 * 60 * 60 * 1000);
}
