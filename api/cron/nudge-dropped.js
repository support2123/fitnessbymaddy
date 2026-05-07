const { supabase } = require('../_lib/supabase');
const { sendTemplate, sendText, checkRateLimit } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const canSend = await checkRateLimit(lead.phone, false);
      if (!canSend) {
        results.push({ phone: lead.phone, action: 'rate_limited' });
        continue;
      }

      const market = lead.market || 'GLOBAL';
      try {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        results.push({ phone: lead.phone, action: 'nudged' });
      } catch {
        const trialUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial';
        if (isHinglish(market)) {
          await sendText(lead.phone,
            `Hey ${lead.name || 'there'}! Abhi bhi soch rahe ho? Maddy ka $20 trial session try karo — no commitment, sirf results.\n\n${trialUrl}`
          );
        } else {
          await sendText(lead.phone,
            `Hey ${lead.name || 'there'}! Still thinking? Try Maddy's $20 trial session — no commitment, just results.\n\n${trialUrl}`
          );
        }
        results.push({ phone: lead.phone, action: 'nudged_text' });
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));
        const dayOfWeek = now.getDay();

        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const nudgeDay = dayOfWeek === 1 ? '+24hr' : '+48hr';
        const market = client.phone?.startsWith('91') ? 'IN' : 'GLOBAL';

        if (isHinglish(market)) {
          await sendText(client.phone,
            `Reminder: Week ${weekNo} check-in abhi tak pending hai! Jaldi fill karo: ${checkinUrl}`
          );
        } else {
          await sendText(client.phone,
            `Reminder: Your Week ${weekNo} check-in is still pending! Fill it out here: ${checkinUrl}`
          );
        }
        results.push({ client_id: client.id, action: `checkin_nudge_${nudgeDay}` });
      }
    }

    return res.status(200).json({ status: 'done', processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Nudge cron failed' });
  }
};
