const { getSupabase } = require('../../lib/supabase');
const { sendWhatsAppMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, failed: 0, nudges_scheduled: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const maxWeeks = getMaxWeeks(client.program);
        if (weekNo > maxWeeks) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey ${client.name || ''}! Week ${weekNo} check-in time!\n\nYeh form fill karo (2 min lagega):\n${checkinUrl}\n\nWeight, waist, photos aur feedback share karo. Tumhara next week ka plan isse customize hoga!`
          : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in!\n\nPlease fill this form (takes 2 min):\n${checkinUrl}\n\nShare your weight, waist, photos and feedback. This helps customise your next week's plan!`;

        await sendWhatsAppMessage(client.phone, msg);
        results.sent++;

        const { count: missedCount } = await db
          .from('checkins')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .lte('week_no', weekNo - 1);

        if (weekNo >= 3 && (!missedCount || missedCount === 0)) {
          await notifyMaddy(
            (p, b) => sendWhatsAppMessage(p, b, '_internal_escalation'),
            '2 consecutive missed check-ins',
            `Client: ${client.name || client.phone} | Program: ${client.program} | Week: ${weekNo}`
          );
        }
      } catch (clientErr) {
        console.error(`Failed for client ${client.id}:`, clientErr.message);
        results.failed++;
      }
    }

    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function getMaxWeeks(program) {
  const map = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return map[program] || 6;
}

function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
