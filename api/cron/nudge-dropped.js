const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Leads that went silent 2hrs+ ago (Flow A step 3 — nudge trial)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: silentLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('last_msg_at', twoHoursAgo)
    .gte('last_msg_at', twentyFourHoursAgo);

  let nudgedSilent = 0;
  if (silentLeads) {
    for (const lead of silentLeads) {
      const { data: nudgeSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (nudgeSent && nudgeSent.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey! \u{1F44B} Maddy ka $20 trial session try karo — no commitment, sirf results:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply karo ya "STOP" to opt out.`
        : `Hey! \u{1F44B} Try Maddy's $20 trial session — no commitment, just results:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply or send "STOP" to opt out.`;

      await sendWhatsApp({ phone: lead.phone, templateName: 'nudge_trial', body });
      nudgedSilent++;
    }
  }

  // Mark 24hr+ silent leads as dropped
  const { data: expiredLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lte('last_msg_at', twentyFourHoursAgo);

  if (expiredLeads && expiredLeads.length > 0) {
    const ids = expiredLeads.map(l => l.id);
    await db.from('leads').update({ status: 'dropped' }).in('id', ids);
  }

  // Re-engage dropped leads (7-day rule, once only)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  let reengaged = 0;
  if (droppedLeads) {
    for (const lead of droppedLeads) {
      const { data: alreadySent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey! Maddy's team se \u{1F44B}\n\nPichle time connect nahi ho paaya. Abhi bhi fitness goals pe kaam karna hai?\n\n$20 mein ek trial Zoom session try karo — no commitment:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply "STOP" to opt out.`
        : `Hey! Maddy's team here \u{1F44B}\n\nWe didn't get to connect last time. Still thinking about your fitness goals?\n\nTry a $20 trial Zoom session — no commitment:\nhttps://fitnessbymaddy.com/program-trial.html\n\nReply "STOP" to opt out.`;

      await sendWhatsApp({ phone: lead.phone, templateName: 'reengage_dropped', body });
      reengaged++;
    }
  }

  res.json({ nudgedSilent, droppedMarked: expiredLeads?.length || 0, reengaged });
};
