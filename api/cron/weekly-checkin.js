const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString())
      .gte('program_ends_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submitted = missedCheckins?.map(c => c.week_no) || [];
      const lastTwo = [weekNo - 1, weekNo - 2];
      const consecutiveMisses = lastTwo.every(w => w > 0 && !submitted.includes(w));

      if (consecutiveMisses) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `Client has missed weeks ${weekNo - 2} and ${weekNo - 1}. Needs personal follow-up.`,
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'GLOBAL';

      const msg = isHinglish(market)
        ? `Week ${weekNo} check-in time! 📊\n\nApna weight, waist, aur progress share karo:\n${checkinUrl}\n\nYe plan adjust karne ke liye important hai.`
        : `Time for your Week ${weekNo} check-in! 📊\n\nShare your weight, waist, and progress:\n${checkinUrl}\n\nThis helps us adjust your plan.`;

      await sendWhatsApp(client.phone, msg, 'weekly_checkin');
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
