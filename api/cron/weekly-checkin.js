const { getSupabase } = require('../../lib/supabase');
const { rateLimitedSend, sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/mask-phone');

const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
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

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (currentWeek > maxWeeks) {
        if (client.status === 'active') {
          await db.from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
        }
        continue;
      }

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('*')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin?.form_submitted_at) {
        continue;
      }

      if (!existingCheckin) {
        await db.from('checkins').insert({
          client_id: client.id,
          week_no: currentWeek
        });

        const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(currentWeek),
          checkinUrl
        ]);
        sent++;
      } else {
        const createdAt = new Date(existingCheckin.created_at);
        const hoursSinceCreated = (now - createdAt) / 3600000;
        const nudgeCount = existingCheckin.nudge_count || 0;

        if (nudgeCount === 0 && hoursSinceCreated >= 24) {
          const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(currentWeek),
            checkinUrl
          ]);
          await db.from('checkins')
            .update({ nudge_count: 1 })
            .eq('id', existingCheckin.id);
          nudged++;
        } else if (nudgeCount === 1 && hoursSinceCreated >= 48) {
          const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_final_reminder', [
            client.name || 'there',
            String(currentWeek),
            checkinUrl
          ]);
          await db.from('checkins')
            .update({ nudge_count: 2 })
            .eq('id', existingCheckin.id);
          nudged++;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .is('form_submitted_at', null)
          .order('week_no', { ascending: false })
          .limit(3);

        if (missedCheckins?.length >= 2) {
          await notifyMaddy(
            '2 missed check-ins',
            `${client.name || maskPhone(client.phone)} has missed ${missedCheckins.length} consecutive check-ins (weeks ${missedCheckins.map(c => c.week_no).join(', ')})`
          );
          escalated++;
        }
      }
    }

    console.log(`Weekly checkin cron: sent=${sent}, nudged=${nudged}, escalated=${escalated}`);

    return res.status(200).json({ ok: true, sent, nudged, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
