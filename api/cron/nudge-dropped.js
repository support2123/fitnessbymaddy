const { supabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { getProgramDetails } = require('../../lib/utils');

function getProgramDurationWeeks(programType) {
  const details = getProgramDetails(programType);
  if (!details) return 6;
  const match = details.duration.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 6;
}

// -------------------------------------------------------
// (a) Nudge new leads who haven't replied
// -------------------------------------------------------
async function nudgeNewLeads() {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let nudged = 0;
  let dropped = 0;

  // Leads still within 24h window but no reply for 2+ hours → send nudge
  const { data: nudgeLeads, error: nudgeErr } = await supabase
    .from('leads')
    .select('id, phone, name')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('sent_at', twentyFourHoursAgo);

  if (nudgeErr) {
    console.error('Failed to fetch nudge leads:', nudgeErr.message);
  } else if (nudgeLeads && nudgeLeads.length > 0) {
    for (const lead of nudgeLeads) {
      try {
        const result = await sendTemplate(lead.phone, 'lead_nudge', [
          lead.name || 'there'
        ]);

        if (result.success) {
          nudged++;
          console.log(`Nudge sent to lead ${maskPhone(lead.phone)}`);
        }
      } catch (err) {
        console.error(`Nudge failed for lead ${lead.id}:`, err.message);
      }
    }
  }

  // Leads older than 24h still 'new' → mark as dropped
  const { data: staleLeads, error: staleErr } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('status', 'new')
    .lt('sent_at', twentyFourHoursAgo);

  if (staleErr) {
    console.error('Failed to fetch stale leads:', staleErr.message);
  } else if (staleLeads && staleLeads.length > 0) {
    const staleIds = staleLeads.map((l) => l.id);

    const { error: updateErr } = await supabase
      .from('leads')
      .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
      .in('id', staleIds);

    if (updateErr) {
      console.error('Failed to mark leads as dropped:', updateErr.message);
    } else {
      dropped = staleIds.length;
      for (const lead of staleLeads) {
        console.log(`Lead ${maskPhone(lead.phone)} marked as dropped`);
      }
    }
  }

  return { nudged, dropped };
}

// -------------------------------------------------------
// (b) Re-engage dropped leads (7-day rule)
// -------------------------------------------------------
async function reEngageDropped() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

  let reEngaged = 0;

  // Find dropped leads whose last message was 7-8 days ago
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, phone, name')
    .eq('status', 'dropped')
    .gte('last_msg_at', eightDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (leadsErr) {
    console.error('Failed to fetch re-engage leads:', leadsErr.message);
    return { reEngaged };
  }

  if (!leads || leads.length === 0) return { reEngaged };

  for (const lead of leads) {
    try {
      // Check if we already sent a re-engage to this lead (one-time only)
      const { data: priorReEngage } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'lead_reengage')
        .limit(1);

      if (priorReEngage && priorReEngage.length > 0) {
        console.log(`Skipping re-engage for ${maskPhone(lead.phone)} — already sent before`);
        continue;
      }

      const result = await sendTemplate(lead.phone, 'lead_reengage', [
        lead.name || 'there'
      ]);

      if (result.success) {
        reEngaged++;
        console.log(`Re-engage sent to ${maskPhone(lead.phone)}`);
      }
    } catch (err) {
      console.error(`Re-engage failed for lead ${lead.id}:`, err.message);
    }
  }

  return { reEngaged };
}

// -------------------------------------------------------
// (c) Nudge clients who haven't submitted check-in
// -------------------------------------------------------
async function nudgeCheckins() {
  const now = new Date();
  let firstNudge = 0;
  let secondNudge = 0;
  let escalated = 0;

  // Fetch active clients
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, name, phone, program, program_started_at')
    .eq('status', 'active');

  if (clientsErr) {
    console.error('Failed to fetch active clients:', clientsErr.message);
    return { firstNudge, secondNudge, escalated };
  }

  if (!clients || clients.length === 0) return { firstNudge, secondNudge, escalated };

  for (const client of clients) {
    try {
      // Calculate current week
      const startDate = new Date(client.program_started_at);
      const diffMs = now.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(diffDays / 7) + 1;

      const maxWeeks = getProgramDurationWeeks(client.program);
      if (weekNo > maxWeeks) continue;

      // Check if check-in was submitted for this week
      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue; // already submitted

      // Find the check-in form message that was sent for this week
      // We look for the weekly_checkin template sent to this client
      const { data: sentMsg } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('phone', client.phone)
        .eq('template_name', 'weekly_checkin')
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (!sentMsg || sentMsg.length === 0) continue; // no form sent yet

      const sentAt = new Date(sentMsg[0].created_at);
      const hoursSinceSent = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60);

      // Determine which nudge to send based on hours elapsed
      if (hoursSinceSent >= 72) {
        // 72h+ → escalate to Maddy (check for 2 missed check-ins)
        const { data: missedCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false });

        const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
        let consecutiveMissed = 0;

        for (let w = weekNo; w >= Math.max(1, weekNo - 2); w--) {
          if (!submittedWeeks.includes(w)) {
            consecutiveMissed++;
          } else {
            break;
          }
        }

        if (consecutiveMissed >= 2) {
          await notifyMaddy(
            'Client Missing Check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\n${consecutiveMissed} consecutive missed check-ins.\nCurrent week: ${weekNo}`
          );
          escalated++;
          console.log(`Escalated ${maskPhone(client.phone)}: ${consecutiveMissed} missed check-ins`);
        } else {
          // Still send third nudge even if not escalating
          await sendTemplate(client.phone, 'checkin_nudge_3', [
            client.name, String(weekNo)
          ]);
          console.log(`Third nudge sent to ${maskPhone(client.phone)} (week ${weekNo})`);
        }
      } else if (hoursSinceSent >= 48) {
        // 48h → second nudge
        // Check we haven't already sent a second nudge
        const { data: priorNudge2 } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge_2')
          .gte('sent_at', sentAt.toISOString())
          .limit(1);

        if (!priorNudge2 || priorNudge2.length === 0) {
          await sendTemplate(client.phone, 'checkin_nudge_2', [
            client.name, String(weekNo)
          ]);
          secondNudge++;
          console.log(`Second nudge sent to ${maskPhone(client.phone)} (week ${weekNo})`);
        }
      } else if (hoursSinceSent >= 24) {
        // 24h → first nudge
        // Check we haven't already sent a first nudge
        const { data: priorNudge1 } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge_1')
          .gte('sent_at', sentAt.toISOString())
          .limit(1);

        if (!priorNudge1 || priorNudge1.length === 0) {
          await sendTemplate(client.phone, 'checkin_nudge_1', [
            client.name, String(weekNo)
          ]);
          firstNudge++;
          console.log(`First nudge sent to ${maskPhone(client.phone)} (week ${weekNo})`);
        }
      }
    } catch (err) {
      console.error(`Check-in nudge error for client ${client.id}:`, err.message);
    }
  }

  return { firstNudge, secondNudge, escalated };
}

// -------------------------------------------------------
// Main handler
// -------------------------------------------------------
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting nudge-dropped cron...');

    const [leadResults, reEngageResults, checkinResults] = await Promise.all([
      nudgeNewLeads(),
      reEngageDropped(),
      nudgeCheckins()
    ]);

    const summary = {
      message: 'Nudge cron completed',
      leads: {
        nudged: leadResults.nudged,
        dropped: leadResults.dropped
      },
      re_engage: {
        sent: reEngageResults.reEngaged
      },
      checkins: {
        first_nudge: checkinResults.firstNudge,
        second_nudge: checkinResults.secondNudge,
        escalated: checkinResults.escalated
      }
    };

    console.log('Nudge summary:', JSON.stringify(summary));

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
