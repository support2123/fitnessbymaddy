const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');
const { maskPhone } = require('../../lib/masking');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', now.toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'ok', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const consecutiveMisses = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMisses) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name || client.id}, last submitted: ${submittedWeeks[0] || 'none'}`
        );
        escalated++;
      }

      const { data: lead } = client.lead_id
        ? await db.from('leads').select('market').eq('id', client.lead_id).single()
        : { data: null };

      const market = lead?.market || 'GLOBAL';
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = isHinglish(market)
        ? `Hey ${client.name || ''}! 💪 Week ${weekNo} check-in ka time hai!\n\nForm yahan fill karo: ${checkinUrl}\n\nWeight, waist, photos aur feel batao — taaki next week ka plan better bane!`
        : `Hey ${client.name || ''}! 💪 Time for your Week ${weekNo} check-in!\n\nFill it out here: ${checkinUrl}\n\nShare your weight, waist, photos, and how you're feeling — so your next week's plan is even better!`;

      await sendWhatsApp(client.phone, msg, 'weekly_checkin', true);
      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent} escalated=${escalated}`);
    return res.status(200).json({ status: 'ok', sent, escalated });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
