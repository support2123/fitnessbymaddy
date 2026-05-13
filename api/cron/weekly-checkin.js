import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { escalateMissedCheckins } from '../lib/escalation.js';

const BASE_URL = 'https://www.fitnessbymaddy.com';

function getCurrentWeek(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weekNo = getCurrentWeek(client.program_started_at);

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `${BASE_URL}/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? [`Hey ${client.name || 'Champion'}! 📊 Week ${weekNo} ka check-in time hai.\n\nYahan fill karo: ${checkinUrl}\n\nWeight, waist, photos — sab daal do. Isse next week ka plan better banega!`]
        : [`Hey ${client.name || 'Champion'}! 📊 It's time for your Week ${weekNo} check-in.\n\nFill it out here: ${checkinUrl}\n\nWeight, waist, photos — the more data, the better your next plan!`];

      await sendTemplate(client.phone, 'weekly_checkin', msg, true);
      sent++;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await escalateMissedCheckins(client.name, client.phone, consecutiveMissed);
        nudged++;
      }
    }

    return res.json({ success: true, sent, escalated: nudged });
  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
