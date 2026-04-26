const { getSupabase } = require('../../lib/supabase');
const { sendText, sendTemplate, notifyMaddy, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const expectedCheckins = Math.min(currentWeek, 2);
      if (expectedCheckins - (missedCount || 0) >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nProgram: ${client.program}\nCurrent Week: ${currentWeek}`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      const market = client.phone.startsWith('+91') || client.phone.startsWith('91') ? 'IN' : 'GLOBAL';

      if (market === 'IN') {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 💪\n\n` +
          `Week ${currentWeek} ka check-in time aa gaya hai!\n\n` +
          `📋 Form: ${checkinUrl}\n\n` +
          `Weight, waist, photos, aur apna update share karo — isse Maddy tumhara next week ka plan better bana paayegi. ✨`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 💪\n\n` +
          `It's Week ${currentWeek} check-in time!\n\n` +
          `📋 Form: ${checkinUrl}\n\n` +
          `Share your weight, measurements, photos & update — helps Maddy fine-tune your next week. ✨`
        );
      }

      sent++;
    }

    return res.json({ message: 'Weekly check-ins sent', sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
