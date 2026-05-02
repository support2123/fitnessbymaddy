const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, isHinglish, maskPhone } = require('../../lib/whatsapp');
const { createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_CRON) {
    // Allow Vercel cron to bypass, but block manual calls without auth
  }

  const db = getSupabase();

  try {
    const { data: clients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existing) continue;

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const recentWeeks = (missedCheckins || []).map(c => c.week_no);
        const lastTwoExpected = [currentWeek - 1, currentWeek - 2].filter(w => w > 0);
        const missedConsecutive = lastTwoExpected.every(w => !recentWeeks.includes(w));

        if (missedConsecutive && currentWeek > 2) {
          await createEscalation(
            client.phone,
            '2_consecutive_missed_checkins',
            `Client ${client.name || maskPhone(client.phone)} missed ${lastTwoExpected.length} consecutive check-ins`,
            client.id
          );
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = client.leads?.market || 'GLOBAL';
        const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

        const result = await sendTemplate(client.phone, templateName, [
          client.name || 'Champion',
          `Week ${currentWeek}`,
          checkinUrl
        ]);

        if (result.ok) sent++;
        else errors++;

      } catch (clientErr) {
        console.error(`[weekly-checkin] Error for client ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    return res.json({ ok: true, sent, errors, total_clients: clients.length });

  } catch (err) {
    console.error('[weekly-checkin] Error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
