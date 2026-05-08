const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/pii');

// ---------------------------------------------------------------------------
// Program duration map (program_type → total weeks)
// ---------------------------------------------------------------------------
const PROGRAM_WEEKS = {
  '6wk': 6,
  '12wk': 12,
  '16wk': 16,
  '24wk': 24,
};

function getTotalWeeks(program) {
  if (!program) return 12;
  for (const [key, weeks] of Object.entries(PROGRAM_WEEKS)) {
    if (program.includes(key)) return weeks;
  }
  return 12;
}

// ---------------------------------------------------------------------------
// Calculate the current week number from program_started_at
// ---------------------------------------------------------------------------
function calcWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1; // week 1 on day 0-6
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

    const results = { sent: 0, skipped: 0, completed: 0, errors: 0 };

    // --- Fetch active clients ---
    const { data: clients, error: fetchErr } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (fetchErr) {
      console.error('Failed to fetch active clients:', fetchErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        if (!client.program_started_at) {
          console.warn(`Client ${client.id} has no program_started_at, skipping`);
          results.skipped++;
          continue;
        }

        const weekNo = calcWeekNo(client.program_started_at);
        const totalWeeks = getTotalWeeks(client.program);

        // --- Check if program is complete ---
        if (weekNo > totalWeeks) {
          const { error: updateErr } = await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          if (updateErr) {
            console.error(
              `Failed to mark client ${client.id} completed:`,
              updateErr.message
            );
            results.errors++;
          } else {
            results.completed++;
          }
          continue;
        }

        // --- Check if checkin already exists for this week ---
        const { data: existing, error: checkinErr } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkinErr) {
          console.error(
            `Checkin lookup failed for client ${client.id}:`,
            checkinErr.message
          );
          results.errors++;
          continue;
        }

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        // --- Send check-in template ---
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const sendResult = await sendTemplate(client.phone, 'weekly_checkin', {
          name: client.name || '',
          templateParams: [client.name || '', String(weekNo), checkinUrl],
        });

        if (sendResult.skipped) {
          results.skipped++;
        } else if (sendResult.ok) {
          results.sent++;
        } else {
          console.error(
            `Failed to send checkin to ${maskPhone(client.phone)}:`,
            sendResult.error
          );
          results.errors++;
        }
      } catch (err) {
        console.error(
          `Error processing client ${client.id} (${maskPhone(client.phone)}):`,
          err.message
        );
        results.errors++;
      }
    }

    console.log('weekly-checkin results:', JSON.stringify(results));
    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('weekly-checkin fatal error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
