const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, canSendTo } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.json({ ok: true, nudged: 0, message: 'No leads to nudge' });
    }

    let nudged = 0;

    for (const lead of newLeads) {
      const allowed = await canSendTo(lead.phone);
      if (!allowed) continue;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        bodyValues: [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/shred.html',
        ],
      });

      nudged++;
    }

    const { data: missedCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (missedCheckins) {
      for (const client of missedCheckins) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const daysSinceCheckinDue = daysSinceSunday();
          if (daysSinceCheckinDue >= 1 && daysSinceCheckinDue <= 2) {
            const allowed = await canSendTo(client.phone);
            if (!allowed) continue;

            await sendWhatsApp({
              phone: client.phone,
              templateName: 'checkin_reminder',
              bodyValues: [
                client.name || 'there',
                String(weekNo),
                `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`,
              ],
            });

            checkinNudges++;
          }

          if (daysSinceCheckinDue >= 14) {
            await notifyMaddyMissedCheckins(db, client);
          }
        }
      }
    }

    return res.json({ ok: true, nudged, checkinNudges });
  } catch (err) {
    console.error('[Cron/Nudge] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7));
}

function daysSinceSunday() {
  const now = new Date();
  const day = now.getDay();
  return day === 0 ? 0 : day;
}

async function notifyMaddyMissedCheckins(db, client) {
  const { count } = await db
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id);

  const weekNo = calculateWeekNo(client.program_started_at);
  const missedCount = weekNo - (count || 0);

  if (missedCount >= 2) {
    const { sendWhatsApp: send } = require('../_lib/whatsapp');
    const { maskPhone } = require('../_lib/whatsapp');
    await send({
      phone: process.env.MADDY_PHONE || '+917082478374',
      templateName: 'escalation_alert',
      bodyValues: [
        maskPhone(client.phone),
        `${missedCount} consecutive missed check-ins`,
        `Client: ${client.name || 'Unknown'}`,
      ],
    });
  }
}
