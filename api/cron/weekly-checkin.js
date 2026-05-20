const { getSupabase } = require('../../lib/supabase');
const { sendText, sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false });

      const submittedWeeks = new Set((missedCheckins || []).map(c => c.week_no));
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1; w--) {
        if (!submittedWeeks.has(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name || client.id} missed ${consecutiveMissed} weeks`
        );
        escalated++;
      }

      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      let msg;
      if (hinglish) {
        msg = `Hey ${client.name || 'there'}! Week ${currentWeek} ka check-in time hai.\n\nApna progress yahan submit kar:\n${checkinUrl}\n\nWeight, waist, compliance aur photos — sab bharke bhej dena. Let's keep going!`;
      } else {
        msg = `Hey ${client.name || 'there'}! It's time for your Week ${currentWeek} check-in.\n\nSubmit your progress here:\n${checkinUrl}\n\nWeight, waist, compliance score, and photos — let's track your journey!`;
      }

      await sendText(client.phone, msg);
      sent++;
    }

    return res.json({
      message: 'Weekly check-in cron complete',
      sent,
      nudged,
      escalated,
      total_clients: activeClients.length
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
