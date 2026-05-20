const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers['authorization'];
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}` ||
                   authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNeedNudge } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeadsNeedNudge) {
      for (const lead of newLeadsNeedNudge) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', lead.created_at || twoHoursAgo)
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const hinglish = isHinglishMarket(lead.market);
        const trialUrl = 'https://fitnessbymaddy.com/program-trial';

        const nudgeMsg = hinglish
          ? `Hey ${lead.name || ''}! 👋 Maddy ka $20 trial session try karo — full guidance, zero risk.\n\n${trialUrl}`
          : `Hey ${lead.name || ''}! 👋 Try Maddy's $20 trial session — full guidance, zero risk.\n\n${trialUrl}`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: nudgeMsg,
        });
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gte('sent_at', twentyFourHoursAgo)
          .limit(1);

        if (replies && replies.length > 0) continue;

        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 're_engage')
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const hinglish = isHinglishMarket(lead.market);
        const msg = hinglish
          ? `${lead.name || 'Hey'}, Maddy ke programs mein limited spots hain. Kya interest hai abhi? Reply karo aur let's get started 💪`
          : `${lead.name || 'Hey'}, limited spots available in Maddy's programs. Still interested? Reply and let's get started 💪`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 're_engage',
          body: msg,
        });
        reEngaged++;
      }
    }

    const { data: missedCheckins } = await db.rpc('get_consecutive_missed_checkins');

    if (missedCheckins) {
      for (const item of missedCheckins) {
        await sendWhatsApp({
          phone: '+917082478374',
          templateName: 'escalation_alert',
          body: `⚠️ MISSED CHECK-INS\nClient: ${item.name} has missed ${item.missed_count} consecutive check-ins. Please follow up.`,
        });
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
