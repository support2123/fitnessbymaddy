const db = require('../_lib/supabase');
const wa = require('../_lib/whatsapp');
const { verifyCronSecret, maskPhone, detectMarket, isHinglish } = require('../_lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const clients = await db.query('clients', 'status=eq.active&select=*');

    let sent = 0;
    let errors = 0;
    const escalations = [];

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const existing = await db.query(
          'checkins',
          `client_id=eq.${client.id}&week_no=eq.${weekNo}&select=id`
        );
        if (existing.length > 0) continue;

        const missedWeeks = await countMissedCheckins(client.id, weekNo);
        if (missedWeeks >= 2) {
          escalations.push(client);
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const hinglish = isHinglish(detectMarket(client.phone));

        const msg = hinglish
          ? `Hey ${client.name || 'there'}! 💪 Week ${weekNo} check-in time. Apna progress update karo:\n${checkinUrl}`
          : `Hey ${client.name || 'there'}! 💪 It's Week ${weekNo} check-in time. Update your progress:\n${checkinUrl}`;

        try {
          await wa.sendTemplate(
            client.phone,
            'weekly_checkin',
            [String(weekNo), checkinUrl],
            client.name || 'there'
          );
          sent++;
        } catch (err) {
          console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
          errors++;
        }

        await db.insert('messages', {
          phone: client.phone,
          direction: 'out',
          body: msg,
          template_name: 'weekly_checkin',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      } catch (err) {
        console.error(`Client ${client.id} checkin error:`, err.message);
        errors++;
      }
    }

    if (escalations.length > 0) {
      const names = escalations.map(c => c.name || maskPhone(c.phone)).join(', ');
      try {
        await wa.sendTemplate(
          MADDY_PHONE,
          'escalation_alert',
          [`⚠️ ${escalations.length} clients have 2+ missed check-ins: ${names}`],
          'Maddy'
        );
      } catch (err) {
        console.error('Escalation alert failed:', err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      total_clients: clients.length,
      sent,
      errors,
      escalations: escalations.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

async function countMissedCheckins(clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 2); w--) {
    const existing = await db.query(
      'checkins',
      `client_id=eq.${clientId}&week_no=eq.${w}&select=id`
    );
    if (existing.length === 0) missed++;
  }
  return missed;
}
