const { getSupabase } = require('../_lib/supabase');
const { sendWhatsAppUnlimited } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { escalate } = require('../_lib/escalation');
const { maskPhone } = require('../_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) { skipped++; continue; }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) { skipped++; continue; }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      if (weekNo - lastSubmittedWeek >= 3) {
        await escalate(
          client.phone,
          '2+ consecutive missed check-ins',
          `Client ${client.name || maskPhone(client.phone)} has not checked in since week ${lastSubmittedWeek}`
        );
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || ''}! Week ${weekNo} ka check-in time hai.\n\nForm yahan bharo: ${checkinUrl}\n\nWeight, waist, photos, aur kaise feel kar rahe ho - sab daal do!`
        : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in.\n\nFill out your form here: ${checkinUrl}\n\nInclude your weight, waist, photos, and how you're feeling!`;

      await sendWhatsAppUnlimited(client.phone, null, msg);
      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return res.status(200).json({
      ok: true,
      sent,
      skipped,
      total: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
