import supabase from '../../lib/supabase.js';
import { sendText } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !clients) {
    console.error('Fetch clients error:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of clients) {
    const weekNo = calculateWeekNo(client.program_started_at);
    const programWeeks = getProgramWeeks(client.program);

    if (weekNo > programWeeks) {
      await supabase
        .from('clients')
        .update({ status: 'completed' })
        .eq('id', client.id);
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

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';
    const formUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const msg = hinglish
      ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time hai. Apna progress share karo:\n${formUrl}`
      : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Share your progress:\n${formUrl}`;

    await sendText(client.phone, msg);
    sent++;
  }

  return res.status(200).json({ ok: true, sent, skipped, total: clients.length });
}

function calculateWeekNo(startedAt) {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)) || 1;
}

function getProgramWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4,
  };
  return map[program] || 6;
}
