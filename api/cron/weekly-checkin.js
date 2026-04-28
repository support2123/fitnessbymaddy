const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const programWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > programWeeks) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 3; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const isIN = client.phone.startsWith('+91');

      const msg = isIN
        ? `Hey ${client.name || ''}! Week ${weekNo} check-in time 📊\n\nApna progress share karo — weight, waist, photos, aur kaise feel kar rahe ho.\n\n👉 ${checkinUrl}\n\n5 min lagega. Honest rehna — that's how we adjust your plan!`
        : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in 📊\n\nShare your progress — weight, waist, photos, and how you're feeling.\n\n👉 ${checkinUrl}\n\nTakes 5 min. Be honest — that's how we optimise your plan!`;

      await sendWhatsApp({ phone: client.phone, body: msg });
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
