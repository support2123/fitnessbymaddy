const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    const results = [];

    for (const lead of newLeads || []) {
      const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

      if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglishMarket(market);
        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

        const msg = hinglish
          ? `Hey! Maddy ka $20 trial session try karna chahenge? Bilkul risk-free hai. Yahan se book karein: ${trialUrl}`
          : `Hey! Want to try Maddy's $20 trial session? Completely risk-free. Book here: ${trialUrl}`;

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: [lead.name || 'there']
        });

        results.push({ phone: maskPhone(lead.phone), action: 'nudge_sent', ...result });
      } else if (hoursSinceMsg >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.push({ phone: maskPhone(lead.phone), action: 'marked_dropped' });
      }
    }

    const { data: checkinNudges } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of checkinNudges || []) {
      const weekNo = calculateCurrentWeek(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const { data: lastMsg } = await db
        .from('messages')
        .select('sent_at, template_name')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .in('template_name', ['weekly_checkin', 'checkin_nudge'])
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (!lastMsg) continue;

      const hoursSinceNudge = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (60 * 60 * 1000);

      if (hoursSinceNudge >= 24 && hoursSinceNudge < 48) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglishMarket(market);

        const msg = hinglish
          ? `Reminder: Week ${weekNo} check-in abhi tak pending hai. Jaldi submit kar dein: ${checkinUrl}`
          : `Reminder: Your Week ${weekNo} check-in is still pending. Submit it here: ${checkinUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          body: msg,
          params: [client.name || 'there', String(weekNo)]
        });

        results.push({ phone: maskPhone(client.phone), action: 'checkin_nudge_sent' });
      }
    }

    return res.status(200).json({
      processed: results.length,
      results
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
