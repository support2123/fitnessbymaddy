const { getSupabase } = require('../../lib/supabase');
const { sendRateLimited } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_checked_in', week: weekNo });
        continue;
      }

      const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      let msg;
      if (isHinglish(market)) {
        msg = `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time hai. Apna progress update karo: ${checkinLink}`;
      } else {
        msg = `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress here: ${checkinLink}`;
      }

      await sendRateLimited(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(weekNo), checkinLink],
        msg
      );

      await checkMissedCheckins(client.id);

      results.push({ client_id: client.id, action: 'checkin_sent', week: weekNo });
    }

    return res.status(200).json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
