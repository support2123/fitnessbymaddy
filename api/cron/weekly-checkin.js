const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { createEscalation, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL');

      if (hinglish) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time aa gaya hai.\n\n` +
          `Apna weight, waist, compliance, aur photos yahan submit karo:\n${checkinUrl}\n\n` +
          `Yeh important hai taaki hum aapka program adjust kar sakein. Let's go!`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! It's time for your Week ${weekNo} check-in.\n\n` +
          `Submit your weight, waist, compliance, and photos here:\n${checkinUrl}\n\n` +
          `This helps us adjust your program for best results. Let's go!`
        );
      }
      sent++;

      const { data: lastTwo } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length > 0) {
        const lastWeek = lastTwo[0].week_no;
        if (weekNo - lastWeek >= 3) {
          await createEscalation(
            client.phone,
            '2+ consecutive missed check-ins',
            `Last check-in was week ${lastWeek}, now at week ${weekNo}`,
            client.id
          );
          await notifyMaddy(client.phone, '2+ consecutive missed check-ins', sendText);
        }
      } else if (weekNo >= 3) {
        await createEscalation(
          client.phone,
          'No check-ins submitted (week ' + weekNo + ')',
          `Client has never submitted a check-in, now at week ${weekNo}`,
          client.id
        );
        await notifyMaddy(client.phone, 'No check-ins submitted', sendText);
      }
    }

    return res.status(200).json({
      ok: true,
      total: activeClients?.length || 0,
      sent,
      skipped
    });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
