const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { createEscalation } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const missedWeeks = await countMissedCheckins(supabase, client.id, weekNo);
      if (missedWeeks >= 2) {
        await createEscalation(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || maskPhone(client.phone)} has missed ${missedWeeks} consecutive check-ins`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: `Hey ${client.name || 'there'}! It's check-in time \u{1F4CB}\n\nWeek ${weekNo} — how did it go? Fill this out so I can adjust your plan:\n\n${checkinUrl}\n\nTakes 2 mins \u{23F0}`,
        params: {
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo), checkinUrl],
        },
      });

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week=${weekNo}`);
    }

    return res.status(200).json({ sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(programStartDate) {
  const start = new Date(programStartDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7);
}

async function countMissedCheckins(supabase, clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .single();

    if (!data) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}
