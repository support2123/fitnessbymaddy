const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { weeksBetween, maskPhone, isHinglish, detectMarket } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    const now = new Date();
    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = weeksBetween(client.program_started_at, now);
      const market = detectMarket(client.phone);

      const { data: existingCheckin } = await db.from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedWeeks } = await db.from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = new Set((missedWeeks || []).map(c => c.week_no));
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= Math.max(1, weekNo - 3); w--) {
        if (!submittedWeeks.has(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', client, `${consecutiveMissed} weeks missed`);
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress share karo:\n${checkinUrl}\n\nWeight, waist, photos aur compliance bharo — yeh help karta hai next week ka plan better banana mein.`,
          true
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n${checkinUrl}\n\nShare your weight, waist, photos and compliance — it helps us build your next week's plan.`,
          true
        );
      }

      sent++;
    }

    console.log(`[weekly-checkin] Sent: ${sent}, Escalated: ${escalated}`);
    return res.status(200).json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('[weekly-checkin] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
