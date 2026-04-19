const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { generateToken } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const totalWeeks = client.program === '12wk' ? 12 : 6;
      if (currentWeek > totalWeeks) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('*')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin && existingCheckin.weight) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .is('weight', null)
        .order('week_no', { ascending: false })
        .limit(3);

      if (missedCheckins && missedCheckins.length >= 2) {
        await notifyMaddy(
          '2 missed check-ins',
          `${client.name} (${maskPhone(client.phone)}) missed ${missedCheckins.length} consecutive check-ins`
        );
        escalated++;
      }

      let token;
      if (existingCheckin) {
        token = existingCheckin.token;
      } else {
        token = generateToken();
        await supabase.from('checkins').insert({
          client_id: client.id,
          week_no: currentWeek,
          token
        });
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}&t=${token}`;

      const { data: lead } = await supabase
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .single();

      const market = lead?.market || 'IN';
      const msg = market === 'IN'
        ? `Hey ${client.name}! 📋 Week ${currentWeek} check-in time. Ye form fill karo (2 min lagega):\n\n${checkinUrl}\n\nWeight, waist, photos aur feel — sab share karo!`
        : `Hey ${client.name}! 📋 Time for your Week ${currentWeek} check-in. Fill this form (takes 2 min):\n\n${checkinUrl}\n\nShare your weight, waist, photos & how you're feeling!`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name,
        templateParams: [client.name, String(currentWeek)]
      }, msg);

      sent++;
    }

    return res.status(200).json({
      ok: true,
      processed: activeClients.length,
      sent,
      escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
