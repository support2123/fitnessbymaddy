import { supabase } from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish } from '../../lib/market.js';
import { maskPhone } from '../../lib/mask.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch clients:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const { data: lead } = await supabase
        .from('leads')
        .select('market')
        .eq('phone', client.phone)
        .single();

      const hinglish = lead ? isHinglish(lead.market) : false;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${skipped} skipped`);
    return res.status(200).json({ status: 'done', sent, skipped });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
