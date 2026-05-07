const { supabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone } = require('../_lib/whatsapp');

const BASE_URL = 'https://fitnessbymaddy.com';
const CONSECUTIVE_MISSED_THRESHOLD = 2;

module.exports = async function handler(req, res) {
  // --- Cron auth ---
  const authHeader = req.headers.authorization || '';
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary = { sent: 0, skipped: 0, escalated: 0, errors: [] };

  try {
    // --- Fetch all active clients ---
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, phone, program_started_at, program_duration_weeks, status')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('Failed to fetch active clients:', clientsErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ...summary, message: 'No active clients found' });
    }

    const now = new Date();

    for (const client of clients) {
      try {
        // --- Calculate current week_no ---
        if (!client.program_started_at) {
          summary.skipped++;
          continue;
        }

        const startDate = new Date(client.program_started_at);
        const msElapsed = now.getTime() - startDate.getTime();
        const weekNo = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000)) + 1;

        // --- Skip if program ended ---
        const durationWeeks = client.program_duration_weeks || 12;
        if (weekNo > durationWeeks) {
          summary.skipped++;
          continue;
        }

        // --- Check if check-in already submitted this week ---
        const { data: existingCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existingCheckin) {
          summary.skipped++;
          continue;
        }

        // --- Send check-in form link ---
        const checkinUrl = `${BASE_URL}/checkin?c=${client.id}&w=${weekNo}`;

        const result = await sendTemplate(client.phone, 'weekly_checkin', {
          userName: client.name || client.phone,
          templateParams: [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ],
        });

        if (result.success) {
          summary.sent++;

          // --- Record that form was sent (for nudge scheduling) ---
          await supabase.from('checkin_reminders').insert({
            client_id: client.id,
            week_no: weekNo,
            form_sent_at: now.toISOString(),
            nudge_count: 0,
          }).then(({ error }) => {
            if (error) {
              console.error(
                `Failed to record checkin reminder for ${maskPhone(client.phone)}:`,
                error.message
              );
            }
          });
        } else {
          summary.skipped++;
        }

        // --- Check for consecutive missed check-ins ---
        const recentWeeks = [];
        for (let w = weekNo - 1; w >= Math.max(1, weekNo - CONSECUTIVE_MISSED_THRESHOLD); w--) {
          recentWeeks.push(w);
        }

        if (recentWeeks.length >= CONSECUTIVE_MISSED_THRESHOLD) {
          const { data: recentCheckins } = await supabase
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .in('week_no', recentWeeks);

          const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
          const missedConsecutive = recentWeeks.every((w) => !submittedWeeks.includes(w));

          if (missedConsecutive) {
            // Escalate to Maddy
            try {
              await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', {
                userName: 'Maddy',
                templateParams: [
                  `Client ${client.name || maskPhone(client.phone)} has missed ${CONSECUTIVE_MISSED_THRESHOLD}+ consecutive check-ins`,
                  maskPhone(client.phone),
                ],
              });
              summary.escalated++;
            } catch (escErr) {
              console.error(
                `Escalation failed for ${maskPhone(client.phone)}:`,
                escErr.message
              );
            }
          }
        }
      } catch (clientErr) {
        summary.errors.push(maskPhone(client.phone || 'unknown'));
        console.error(
          `Error processing client ${maskPhone(client.phone || '')}:`,
          clientErr.message
        );
      }
    }

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
