const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const results = { nudged_leads: 0, nudged_checkins: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', twoDaysAgo);

    for (const lead of (newLeads || [])) {
      try {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          hinglish
            ? 'Abhi $20 mein trial session try karo!'
            : 'Try a trial session for just $20!',
        ]);
        results.nudged_leads++;
      } catch (e) {
        results.errors++;
      }
    }

    const tooOld = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', tooOld)
      .lt('last_msg_at', tooOld);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      try {
        const weeksSinceStart = Math.max(1, Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        ));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksSinceStart)
          .single();

        if (!checkin) {
          const { data: lastMsg } = await db
            .from('messages')
            .select('sent_at')
            .eq('phone', client.phone)
            .eq('direction', 'out')
            .order('sent_at', { ascending: false })
            .limit(1)
            .single();

          if (lastMsg && new Date(lastMsg.sent_at) < new Date(oneDayAgo)) {
            const market = detectMarket(client.phone);
            const hinglish = isHinglish(market);

            const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
              ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
              : 'https://fitnessbymaddy.com';

            const msg = hinglish
              ? `Reminder! 📋 Week ${weeksSinceStart} ka check-in abhi tak nahi aaya. Yahan submit karo: ${baseUrl}/checkin?c=${client.id}&w=${weeksSinceStart}`
              : `Reminder! 📋 Your Week ${weeksSinceStart} check-in is still pending. Submit here: ${baseUrl}/checkin?c=${client.id}&w=${weeksSinceStart}`;

            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              `${weeksSinceStart}`,
            ]);
            results.nudged_checkins++;
          }
        }
      } catch (e) {
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
