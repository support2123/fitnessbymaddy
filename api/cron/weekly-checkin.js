import supabase from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { logMessage } from '../lib/rate-limit.js';

const CHECKIN_BASE = 'https://fitnessbymaddy.com/checkin.html';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `${CHECKIN_BASE}?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'GLOBAL';

      const msg = market === 'IN'
        ? `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in time. Apna progress update karo — weight, waist, photos, aur overall feel.\n\n${checkinUrl}\n\n5 min lagega, aur Maddy ko tumhara next week plan banane mein help karega 💪`
        : `Hey ${client.name || ''}! 📋 Time for your Week ${weekNo} check-in. Update your progress — weight, waist, photos, and how you're feeling.\n\n${checkinUrl}\n\nTakes 5 mins and helps Maddy build your next week's plan 💪`;

      await sendText(client.phone, msg);
      await logMessage(client.phone, 'out', msg, 'weekly_checkin');
      sent++;
    }

    return res.status(200).json({ status: 'ok', sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
