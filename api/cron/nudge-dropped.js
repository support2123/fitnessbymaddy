const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const market = lead.market || detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${lead.name || ''}! 👋 Maddy ka $20 trial try karna hai? Ek Zoom session mein dekho ki coaching kaise kaam karta hai.\n\nTrial link: https://fitnessbymaddy.com/program-trial.html\n\nLimited spots hain — jaldi karo!`
        : `Hey ${lead.name || ''}! 👋 Want to try Maddy's $20 trial? See how coaching works in just one Zoom session.\n\nTrial link: https://fitnessbymaddy.com/program-trial.html\n\nLimited spots — don't miss out!`;

      const result = await sendWhatsApp({ phone: lead.phone, message: msg, templateName: 'nudge_trial' });

      if (result.ok) {
        nudged++;
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weeksActive = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksActive)
          .maybeSingle();

        if (checkin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastMsg && new Date(lastMsg.sent_at) > new Date(twoDaysAgo)) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksActive}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Reminder! 📋 Week ${weeksActive} check-in abhi tak pending hai.\n\nYahan submit karo: ${checkinUrl}\n\nProgress track karna important hai — 5 min lagega!`
          : `Reminder! 📋 Your Week ${weeksActive} check-in is still pending.\n\nSubmit here: ${checkinUrl}\n\nTracking progress matters — takes just 5 minutes!`;

        await sendWhatsApp({ phone: client.phone, message: msg, templateName: 'checkin_nudge' });
      }
    }

    return res.status(200).json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
