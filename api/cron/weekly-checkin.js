const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { jsonResponse } = require('../../lib/utils');

module.exports = async function handler(req) {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return jsonResponse({ ok: true, processed: 0 });
    }

    let processed = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= 2 && lastWeek < weeksSinceStart - 1) {
        const { count: missedCount } = await db
          .from('checkins')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .gte('week_no', weeksSinceStart - 2);

        if (missedCount === 0) {
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            details: `${client.name || 'Client'} has missed check-ins for weeks ${weeksSinceStart - 1} and ${weeksSinceStart}.`
          });
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksSinceStart}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        weeksSinceStart.toString(),
        checkinUrl
      ]);

      processed++;
    }

    return jsonResponse({ ok: true, processed });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
};
