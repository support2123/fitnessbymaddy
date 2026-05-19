import { createClient } from '../../lib/supabase.js';
import { sendTemplate, sendText } from '../../lib/whatsapp.js';
import { maskPhone } from '../../lib/helpers.js';

// Daily cron — re-engage dropped leads, nudge silent leads, remind pending check-ins
// Schedule: daily at 6:00 UTC — see vercel.json

export default async function handler(req, res) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token || token !== process.env.CRON_SECRET) {
      console.warn('[nudge-dropped] Unauthorized cron request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient();
    const now = new Date();

    let reengaged = 0;
    let nudgedLeads = 0;
    let nudgedClients = 0;

    // ── A) Re-engage dropped leads (7-day rule) ──────────────────
    try {
      reengaged = await reengageDroppedLeads(supabase, now);
    } catch (err) {
      console.error('[nudge-dropped] Part A failed:', err.message);
    }

    // ── B) Nudge silent new leads (2-3 hour window) ──────────────
    try {
      nudgedLeads = await nudgeSilentLeads(supabase, now);
    } catch (err) {
      console.error('[nudge-dropped] Part B failed:', err.message);
    }

    // ── C) Nudge clients with pending check-ins ──────────────────
    try {
      nudgedClients = await nudgePendingCheckins(supabase, now);
    } catch (err) {
      console.error('[nudge-dropped] Part C failed:', err.message);
    }

    console.log(
      `[nudge-dropped] Done: reengaged=${reengaged}, nudged_leads=${nudgedLeads}, nudged_clients=${nudgedClients}`
    );

    return res.status(200).json({
      success: true,
      reengaged,
      nudged_leads: nudgedLeads,
      nudged_clients: nudgedClients,
    });
  } catch (err) {
    console.error('[nudge-dropped] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// A) Re-engage dropped leads created exactly 7-8 days ago
// ─────────────────────────────────────────────────────────────────
async function reengageDroppedLeads(supabase, now) {
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, phone, name')
    .eq('status', 'dropped')
    .gte('created_at', eightDaysAgo)
    .lte('created_at', sevenDaysAgo);

  if (error) {
    console.error('[nudge-dropped] A: query failed:', error.message);
    return 0;
  }

  if (!leads || leads.length === 0) return 0;

  let count = 0;

  for (const lead of leads) {
    try {
      const result = await sendTemplate(lead.phone, 'reengagement_v1', [
        lead.name || 'there',
      ]);

      if (result) {
        count++;
        console.log(`[nudge-dropped] A: re-engaged ${maskPhone(lead.phone)}`);
      }
    } catch (err) {
      console.error(`[nudge-dropped] A: failed for ${maskPhone(lead.phone)}:`, err.message);
    }
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────
// B) Nudge new leads who haven't replied (2-3 hour window)
// ─────────────────────────────────────────────────────────────────
async function nudgeSilentLeads(supabase, now) {
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, phone, name')
    .eq('status', 'new')
    .is('last_msg_at', null)
    .gte('created_at', threeHoursAgo)
    .lte('created_at', twoHoursAgo);

  if (error) {
    console.error('[nudge-dropped] B: query failed:', error.message);
    return 0;
  }

  if (!leads || leads.length === 0) return 0;

  let count = 0;

  for (const lead of leads) {
    try {
      const result = await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
      ]);

      if (result) {
        count++;
        console.log(`[nudge-dropped] B: nudged silent lead ${maskPhone(lead.phone)}`);
      }
    } catch (err) {
      console.error(`[nudge-dropped] B: failed for ${maskPhone(lead.phone)}:`, err.message);
    }
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────
// C) Nudge clients with pending check-ins
// ─────────────────────────────────────────────────────────────────
async function nudgePendingCheckins(supabase, now) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Find active clients
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (clientsErr) {
    console.error('[nudge-dropped] C: clients query failed:', clientsErr.message);
    return 0;
  }

  if (!clients || clients.length === 0) return 0;

  let count = 0;

  for (const client of clients) {
    const masked = maskPhone(client.phone);

    try {
      const startedAt = new Date(client.program_started_at);
      const daysSinceStart = (now.getTime() - startedAt.getTime()) / MS_PER_DAY;
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      // Check if a weekly_checkin message was sent for this client's phone
      const { data: sentMsg, error: msgErr } = await supabase
        .from('messages')
        .select('id, sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .eq('template_name', 'weekly_checkin')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (msgErr || !sentMsg) continue;

      // Check if a matching checkin record exists for the current week
      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .maybeSingle();

      // Client has submitted — no nudge needed
      if (checkin) continue;

      // Calculate hours since the check-in message was sent
      const sentAt = new Date(sentMsg.sent_at);
      const hoursSinceSent = (now.getTime() - sentAt.getTime()) / (60 * 60 * 1000);

      // Check when we last nudged this client (any outbound after the checkin message)
      const { data: lastNudge } = await supabase
        .from('messages')
        .select('id, sent_at, template_name')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .in('template_name', ['checkin_reminder', 'checkin_final_reminder'])
        .gt('sent_at', sentMsg.sent_at)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const hoursSinceLastNudge = lastNudge
        ? (now.getTime() - new Date(lastNudge.sent_at).getTime()) / (60 * 60 * 1000)
        : null;

      if (hoursSinceSent >= 48 && (!lastNudge || hoursSinceLastNudge >= 24)) {
        // 48+ hours: send final reminder
        const result = await sendTemplate(client.phone, 'checkin_final_reminder', [
          client.name || 'there',
          String(currentWeek),
        ]);
        if (result) {
          count++;
          console.log(`[nudge-dropped] C: final reminder to ${masked} for week ${currentWeek}`);
        }
      } else if (hoursSinceSent >= 24 && !lastNudge) {
        // 24+ hours, first nudge
        const result = await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(currentWeek),
        ]);
        if (result) {
          count++;
          console.log(`[nudge-dropped] C: reminder to ${masked} for week ${currentWeek}`);
        }
      }

      // Check for 2 consecutive missed weeks → escalate to Maddy
      if (currentWeek >= 2) {
        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .in('week_no', [currentWeek, currentWeek - 1]);

        const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
        const missedCurrent = !submittedWeeks.includes(currentWeek);
        const missedPrevious = !submittedWeeks.includes(currentWeek - 1);

        if (missedCurrent && missedPrevious) {
          const maddyPhone = process.env.MADDY_PHONE;
          if (maddyPhone) {
            await sendText(
              maddyPhone,
              `Escalation: ${client.name || masked} has missed 2 consecutive check-ins (weeks ${currentWeek - 1} & ${currentWeek}). Please follow up manually.`
            );
            console.log(`[nudge-dropped] C: escalated ${masked} to Maddy (2 missed weeks)`);
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] C: error for ${masked}:`, err.message);
    }
  }

  return count;
}
