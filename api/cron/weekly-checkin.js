import supabase from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { escalateToMaddy } from '../../lib/escalation.js';
import { isHinglish } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];
    const siteBase = process.env.SITE_URL || 'https://fitnessbymaddy.com';

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const missedCount = await checkMissedCheckins(client.id, weekNo);
      if (missedCount >= 2) {
        await escalateToMaddy('2_missed_checkins', client.phone,
          `Client ${client.name || client.phone} has missed ${missedCount} consecutive check-ins`);
      }

      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const formUrl = `${siteBase}/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || ''}! Week ${weekNo} ka check-in time aa gaya. Apna progress yahan fill karo: ${formUrl}`
        : `Hey ${client.name || ''}! It's time for your Week ${weekNo} check-in. Submit your progress here: ${formUrl}`;

      const result = await sendWhatsApp(client.phone, msg, null, true);
      results.push({ client_id: client.id, weekNo, sent: result.ok !== false });
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

async function checkMissedCheckins(clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 3); w--) {
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .limit(1);
    if (!data || data.length === 0) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}
