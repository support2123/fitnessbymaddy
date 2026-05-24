const { getSupabase } = require('../lib/supabase');
const { sendText, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNumber(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = market === 'IN'
        ? `Hey ${client.name?.split(' ')[0] || ''}! 📋 Week ${weekNo} ka check-in time!\n\nYe form fill karo (2 min lagega): ${checkinUrl}\n\nWeight, waist, energy level + progress photos daalo. Isse aapka next week plan better customize hoga! 💪`
        : `Hey ${client.name?.split(' ')[0] || ''}! 📋 Time for your Week ${weekNo} check-in!\n\nFill this form (takes 2 min): ${checkinUrl}\n\nInclude weight, waist, energy level + progress photos. This helps us customize your next week! 💪`;

      await sendText(client.phone, msg);
      sent++;

      await new Promise(r => setTimeout(r, 500));
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
