const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('../_lib/escalation');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['x-cron-secret'] || req.headers.authorization;
  if (process.env.CRON_SECRET && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase.from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients?.length) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await supabase.from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing?.form_submitted_at) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (!existing) {
        const tpl = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';
        await sendTemplate(client.phone, tpl, [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
        sent++;
      } else {
        const submittedAt = new Date(existing.form_submitted_at || 0);
        const hoursSince = (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60);

        if (hoursSince >= 48) {
          await notifyMaddy(supabase, sendTemplate,
            { name: client.name, phone: client.phone },
            `Missed check-in week ${weekNo} (48hrs+)`
          );

          const { data: prevMissed } = await supabase.from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .is('form_submitted_at', null)
            .order('week_no', { ascending: false })
            .limit(2);

          if (prevMissed?.length >= 2) {
            await notifyMaddy(supabase, sendTemplate,
              { name: client.name, phone: client.phone },
              `2 consecutive missed check-ins — needs personal outreach`
            );
          }
        } else if (hoursSince >= 24) {
          const tpl = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge';
          await sendTemplate(client.phone, tpl, [client.name || 'there', checkinUrl]);
          nudged++;
        }
      }
    }

    return res.status(200).json({ sent, nudged, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}
