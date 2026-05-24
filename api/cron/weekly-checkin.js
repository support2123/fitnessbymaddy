const crypto = require('crypto');
const { supabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');
const { getProgramDetails } = require('../../lib/utils');

function generateCheckinToken(clientId, weekNo) {
  return crypto
    .createHmac('sha256', process.env.CHECKIN_SECRET)
    .update(`${clientId}${weekNo}`)
    .digest('hex');
}

function getProgramDurationWeeks(programType) {
  const details = getProgramDetails(programType);
  if (!details) return 6; // default fallback
  const match = details.duration.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 6;
}

module.exports = async function handler(req, res) {
  // Vercel cron jobs use GET
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- Fetch all active clients ---
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at, status')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('Failed to fetch active clients:', clientsErr.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    if (!clients || clients.length === 0) {
      console.log('No active clients found');
      return res.status(200).json({ message: 'No active clients', sent: 0, completed: 0 });
    }

    const now = new Date();
    let sent = 0;
    let completed = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        // --- Calculate current week number ---
        const startDate = new Date(client.program_started_at);
        const diffMs = now.getTime() - startDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(diffDays / 7) + 1;

        // --- Check if program has ended ---
        const maxWeeks = getProgramDurationWeeks(client.program);

        if (weekNo > maxWeeks) {
          const { error: updateErr } = await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          if (updateErr) {
            console.error(`Failed to mark client ${client.id} as completed:`, updateErr.message);
          } else {
            console.log(`Client ${maskPhone(client.phone)} completed program (week ${weekNo} > ${maxWeeks})`);
            completed++;
          }
          continue;
        }

        // --- Generate check-in token ---
        const token = generateCheckinToken(client.id, weekNo);

        // --- Build check-in URL ---
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}&t=${token}`;

        // --- Send WhatsApp template ---
        const result = await sendTemplate(
          client.phone,
          'weekly_checkin',
          [client.name, String(weekNo), checkinUrl]
        );

        if (result.success) {
          sent++;
          console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
        } else {
          console.warn(`Check-in send failed for ${maskPhone(client.phone)}: ${result.reason}`);
          errors++;
        }
      } catch (clientErr) {
        console.error(`Error processing client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    const summary = {
      message: 'Weekly check-in cron completed',
      total_clients: clients.length,
      sent,
      completed,
      errors
    };

    console.log('Weekly check-in summary:', JSON.stringify(summary));

    return res.status(200).json(summary);
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
