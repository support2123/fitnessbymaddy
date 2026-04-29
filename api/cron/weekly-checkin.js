const { supabase } = require('../_lib/supabase');
const { sendText, maskPhone } = require('../_lib/whatsapp');
const { FORM_BASE_URL } = require('../_lib/constants');

// Program duration in weeks
const PROGRAM_DURATIONS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  zoom_trial: 4,
  zoom_group: 4,
  pcos: 8,
  '40plus': 8,
};

function getWeekNumber(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1; // Week 1 is the first week
}

function getProgramDuration(program) {
  if (!program) return null;
  // Match prefix for 6wk variants
  if (program.startsWith('6wk')) return 6;
  if (program.startsWith('zoom_')) return 4;
  return PROGRAM_DURATIONS[program] || null;
}

module.exports = async function handler(req, res) {
  // Verify cron auth
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error: fetchError } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (fetchError) {
      console.error('Failed to fetch active clients:', fetchError.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ clients_notified: 0, clients_completed: 0 });
    }

    let clientsNotified = 0;
    let clientsCompleted = 0;

    for (const client of clients) {
      try {
        const weekNo = getWeekNumber(client.program_started_at);
        const duration = getProgramDuration(client.program);

        // If week exceeds program duration, mark as completed
        if (duration && weekNo > duration) {
          const { error: updateError } = await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          if (updateError) {
            console.error(
              `Failed to mark client ${maskPhone(client.phone)} as completed:`,
              updateError.message
            );
          }

          clientsCompleted++;
          console.log(`Client ${maskPhone(client.phone)} completed (week ${weekNo} > ${duration})`);
          continue;
        }

        const checkinLink = `${FORM_BASE_URL}/checkin?c=${client.id}&w=${weekNo}`;
        const displayName = client.name || 'there';
        const message = `Hey ${displayName}! Time for your Week ${weekNo} check-in. Fill out your stats and upload progress pics here: ${checkinLink}`;

        const result = await sendText(client.phone, message);

        if (result.success) {
          clientsNotified++;
          console.log(
            `Check-in sent to ${maskPhone(client.phone)} for week ${weekNo}`
          );
        } else {
          console.error(
            `Failed to send check-in to ${maskPhone(client.phone)}: ${result.reason}`
          );
        }
      } catch (clientErr) {
        console.error(
          `Error processing client ${maskPhone(client.phone)}:`,
          clientErr.message
        );
      }
    }

    return res.status(200).json({
      clients_notified: clientsNotified,
      clients_completed: clientsCompleted,
    });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
