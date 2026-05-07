const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { notifyMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          supabase, sendText,
          '2 consecutive missed check-ins',
          `Client: ${client.name || client.phone}, missed ${consecutiveMissed} weeks`
        );
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.phone?.startsWith('91') ? 'IN' : 'GLOBAL';

      try {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
        results.push({ client_id: client.id, action: 'sent', week: weekNo });
      } catch {
        if (isHinglish(market)) {
          await sendText(client.phone,
            `Hey ${client.name || 'there'}! Week ${weekNo} check-in time.\n\nForm fill karo: ${checkinUrl}\n\nWeight, waist, photos aur feedback dedo taaki next week ka plan aur better ho!`
          );
        } else {
          await sendText(client.phone,
            `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in.\n\nFill it out here: ${checkinUrl}\n\nInclude your weight, waist, photos, and feedback so we can optimize next week's plan!`
          );
        }
        results.push({ client_id: client.id, action: 'sent_text_fallback', week: weekNo });
      }
    }

    return res.status(200).json({ status: 'done', processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
