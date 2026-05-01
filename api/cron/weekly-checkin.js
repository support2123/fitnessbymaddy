const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients?.length) return res.json({ message: 'No active clients', ...results });

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin?.form_submitted_at) continue;

        const hinglish = isHinglish(detectMarketFromPhone(client.phone));
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        if (!existingCheckin) {
          await sendTemplate(client.phone, 'weekly_checkin', [
            client.name || 'there',
            weekNo.toString(),
            checkinUrl
          ]);
          results.sent++;
        }

        const missedWeeks = await countMissedCheckins(db, client.id, weekNo);
        if (missedWeeks >= 2) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            name: client.name,
            message: `Missed ${missedWeeks} consecutive check-ins (current week: ${weekNo})`
          });
          results.escalated++;
        }
      } catch (err) {
        console.error('Error processing client:', err.message);
        results.errors++;
      }
    }

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

async function countMissedCheckins(db, clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek; w >= Math.max(1, currentWeek - 3); w--) {
    const { data } = await db
      .from('checkins')
      .select('form_submitted_at')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .single();

    if (!data?.form_submitted_at) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}

function detectMarketFromPhone(phone) {
  if (phone?.startsWith('+91')) return 'IN';
  return 'GLOBAL';
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
