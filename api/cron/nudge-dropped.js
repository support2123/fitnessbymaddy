const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/pii');

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Part A — Lead Nudges
// ---------------------------------------------------------------------------
async function nudgeLeads() {
  const stats = { nudged: 0, dropped: 0, errors: 0 };

  try {
    // Leads that are still 'new', last messaged us 2-24 hours ago
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, phone, name, last_msg_at, created_at')
      .eq('status', 'new')
      .lte('last_msg_at', hoursAgo(2))
      .gte('last_msg_at', hoursAgo(24));

    if (error) {
      console.error('Lead nudge query failed:', error.message);
      stats.errors++;
      return stats;
    }

    for (const lead of leads || []) {
      try {
        // Check we haven't sent outbound in last 2 hours
        const { data: recent, error: msgErr } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', hoursAgo(2))
          .limit(1);

        if (msgErr) {
          console.error(
            `Outbound check failed for ${maskPhone(lead.phone)}:`,
            msgErr.message
          );
          stats.errors++;
          continue;
        }

        if (recent && recent.length > 0) continue; // already messaged recently

        const result = await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || '',
          templateParams: [lead.name || ''],
        });

        if (result.ok) stats.nudged++;
      } catch (err) {
        console.error(
          `Lead nudge error for ${maskPhone(lead.phone)}:`,
          err.message
        );
        stats.errors++;
      }
    }

    // Drop leads that have been 'new' for > 24 hours with no reply
    const { data: staleLeads, error: staleErr } = await supabase
      .from('leads')
      .select('id, phone, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', hoursAgo(24));

    if (staleErr) {
      console.error('Stale-lead query failed:', staleErr.message);
      stats.errors++;
      return stats;
    }

    for (const lead of staleLeads || []) {
      try {
        // Check if the lead ever replied (any inbound message)
        const { data: replies, error: repErr } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.last_msg_at)
          .limit(1);

        if (repErr) {
          console.error(
            `Reply check failed for ${maskPhone(lead.phone)}:`,
            repErr.message
          );
          stats.errors++;
          continue;
        }

        if (replies && replies.length > 0) continue; // they did reply

        const { error: updateErr } = await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);

        if (updateErr) {
          console.error(
            `Failed to drop lead ${maskPhone(lead.phone)}:`,
            updateErr.message
          );
          stats.errors++;
        } else {
          stats.dropped++;
        }
      } catch (err) {
        console.error(
          `Drop-lead error for ${maskPhone(lead.phone)}:`,
          err.message
        );
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('nudgeLeads fatal error:', err.message);
    stats.errors++;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Part B — Check-in Nudges
// ---------------------------------------------------------------------------
async function nudgeCheckins() {
  const stats = { reminded: 0, urgent: 0, escalated: 0, errors: 0 };

  try {
    // Find outbound weekly_checkin template messages from the last 7 days
    const { data: sentCheckins, error } = await supabase
      .from('messages')
      .select('id, phone, sent_at')
      .eq('direction', 'out')
      .eq('template_name', 'weekly_checkin')
      .gte('sent_at', daysAgo(7))
      .order('sent_at', { ascending: false });

    if (error) {
      console.error('Checkin message query failed:', error.message);
      stats.errors++;
      return stats;
    }

    // Group by phone — take the most recent checkin send per phone
    const byPhone = {};
    for (const msg of sentCheckins || []) {
      if (!byPhone[msg.phone]) byPhone[msg.phone] = msg;
    }

    for (const phone of Object.keys(byPhone)) {
      try {
        const msg = byPhone[phone];

        // Look up the client
        const { data: clients, error: clientErr } = await supabase
          .from('clients')
          .select('id, name, phone')
          .eq('phone', phone)
          .eq('status', 'active')
          .limit(1);

        if (clientErr || !clients || clients.length === 0) continue;

        const client = clients[0];

        // Check if there's a corresponding checkin record after the message
        const { data: checkins, error: chkErr } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .gte('form_submitted_at', msg.sent_at)
          .limit(1);

        if (chkErr) {
          console.error(
            `Checkin lookup failed for ${maskPhone(phone)}:`,
            chkErr.message
          );
          stats.errors++;
          continue;
        }

        if (checkins && checkins.length > 0) continue; // checkin submitted

        const sentAt = new Date(msg.sent_at);
        const hoursSinceSent = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60);

        // First nudge at ~24 hours
        if (hoursSinceSent >= 24 && hoursSinceSent < 48) {
          // Check we haven't already sent this reminder
          const { data: alreadySent } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', phone)
            .eq('direction', 'out')
            .eq('template_name', 'checkin_reminder')
            .gte('sent_at', msg.sent_at)
            .limit(1);

          if (alreadySent && alreadySent.length > 0) continue;

          const result = await sendTemplate(phone, 'checkin_reminder', {
            name: client.name || '',
            templateParams: [client.name || ''],
          });

          if (result.ok) stats.reminded++;
        }

        // Second (urgent) nudge at ~48 hours
        if (hoursSinceSent >= 48) {
          const { data: alreadySent } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', phone)
            .eq('direction', 'out')
            .eq('template_name', 'checkin_urgent')
            .gte('sent_at', msg.sent_at)
            .limit(1);

          if (alreadySent && alreadySent.length > 0) continue;

          const result = await sendTemplate(phone, 'checkin_urgent', {
            name: client.name || '',
            templateParams: [client.name || ''],
          });

          if (result.ok) stats.urgent++;
        }

        // Escalate if 2 consecutive weeks missed
        const { data: recentCheckins, error: histErr } = await supabase
          .from('messages')
          .select('id, sent_at')
          .eq('phone', phone)
          .eq('direction', 'out')
          .eq('template_name', 'weekly_checkin')
          .order('sent_at', { ascending: false })
          .limit(2);

        if (histErr || !recentCheckins || recentCheckins.length < 2) continue;

        // Check if client has checkin records for either of the last 2 weeks
        let missedCount = 0;
        for (const checkinMsg of recentCheckins) {
          const { data: found } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .gte('created_at', checkinMsg.sent_at)
            .limit(1);

          if (!found || found.length === 0) missedCount++;
        }

        if (missedCount >= 2) {
          // Check if we already escalated for this client recently
          const { data: prevEsc } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', process.env.MADDY_PHONE)
            .eq('direction', 'out')
            .eq('template_name', 'coach_escalation')
            .gte('sent_at', daysAgo(7))
            .ilike('body', `%${client.id}%`)
            .limit(1);

          if (prevEsc && prevEsc.length > 0) continue;

          // Notify Maddy
          const escResult = await sendTemplate(
            process.env.MADDY_PHONE,
            'coach_escalation',
            {
              name: 'Maddy',
              templateParams: [
                client.name || 'A client',
                maskPhone(client.phone),
                '2 consecutive weeks',
              ],
            }
          );

          if (escResult.ok) stats.escalated++;
        }
      } catch (err) {
        console.error(
          `Checkin nudge error for ${maskPhone(phone)}:`,
          err.message
        );
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('nudgeCheckins fatal error:', err.message);
    stats.errors++;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Part C — Lead Re-engagement (7-day rule)
// ---------------------------------------------------------------------------
async function reengageLeads() {
  const stats = { sent: 0, errors: 0 };

  try {
    // Find leads dropped > 7 days ago but < 30 days ago
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, phone, name, last_msg_at')
      .eq('status', 'dropped')
      .lt('last_msg_at', daysAgo(7))
      .gte('last_msg_at', daysAgo(30));

    if (error) {
      console.error('Re-engagement query failed:', error.message);
      stats.errors++;
      return stats;
    }

    for (const lead of leads || []) {
      try {
        // Check if win_back was already sent
        const { data: alreadySent, error: msgErr } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'win_back')
          .limit(1);

        if (msgErr) {
          console.error(
            `Win-back check failed for ${maskPhone(lead.phone)}:`,
            msgErr.message
          );
          stats.errors++;
          continue;
        }

        if (alreadySent && alreadySent.length > 0) continue; // already sent

        const result = await sendTemplate(lead.phone, 'win_back', {
          name: lead.name || '',
          templateParams: [lead.name || ''],
        });

        if (result.ok) stats.sent++;
      } catch (err) {
        console.error(
          `Re-engagement error for ${maskPhone(lead.phone)}:`,
          err.message
        );
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('reengageLeads fatal error:', err.message);
    stats.errors++;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  try {
    // --- Auth ---
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [leadStats, checkinStats, reengageStats] = await Promise.all([
      nudgeLeads(),
      nudgeCheckins(),
      reengageLeads(),
    ]);

    const summary = {
      ok: true,
      leads: leadStats,
      checkins: checkinStats,
      reengagement: reengageStats,
    };

    console.log('nudge-dropped results:', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error('nudge-dropped fatal error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
