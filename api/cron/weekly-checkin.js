const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');
const { escalate } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
        if (endDate && now > endDate) {
          await db
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          results.push({ client_id: client.id, action: 'completed' });
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1)
          .single();

        if (existingCheckin) {
          results.push({ client_id: client.id, action: 'already_submitted' });
          continue;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
        let consecutiveMissed = 0;
        for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 3; w--) {
          if (!submittedWeeks.includes(w)) {
            consecutiveMissed++;
          } else {
            break;
          }
        }

        if (consecutiveMissed >= 2) {
          await escalate(
            client.phone,
            'consecutive_missed_checkins',
            `${consecutiveMissed} consecutive missed check-ins`,
            client.id
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp(client.phone, 'weekly_checkin_v1', [
          client.name || 'there',
          `Week ${currentWeek}`,
          checkinUrl,
        ]);

        results.push({ client_id: client.id, action: 'sent', week: currentWeek });
      } catch (clientErr) {
        console.error(`[CRON] Error for ${maskPhone(client.phone)}:`, clientErr.message);
        results.push({ client_id: client.id, action: 'error', error: clientErr.message });
      }
    }

    console.log(`[WEEKLY CHECKIN CRON] Processed ${activeClients.length} clients`);
    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('[WEEKLY CHECKIN CRON ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
