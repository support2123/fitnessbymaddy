const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;

    // --- PART 1: Nudge new leads who haven't replied ---

    // 2-hour nudge: leads created 2+ hrs ago, still status=new
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    for (const lead of staleLeads || []) {
      const hoursSinceCreation = (now.getTime() - new Date(lead.created_at).getTime()) / (60 * 60 * 1000);

      // Check if we already nudged (via messages audit)
      const { data: nudges } = await supabase
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .in('template_name', ['nudge_trial', 'lead_dropped']);

      const alreadyNudged = (nudges || []).map(n => n.template_name);

      if (hoursSinceCreation >= 24) {
        // 24h+ with no reply → drop
        if (!alreadyNudged.includes('lead_dropped')) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }
        continue;
      }

      if (hoursSinceCreation >= 2 && !alreadyNudged.includes('nudge_trial')) {
        const isHinglish = (lead.market || detectMarket(lead.phone)) === 'IN';
        const body = isHinglish
          ? `Hey ${lead.name || 'there'}! 👋 Abhi tak decide nahi kiya? Maddy ka $20 trial try karo — ek Zoom session mein samajh aa jayega ki coaching kaise kaam karti hai.\n\nhttps://fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || 'there'}! 👋 Still deciding? Try Maddy's $20 trial — one Zoom session to see how coaching works.\n\nhttps://fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body,
          params: [lead.name || 'there']
        });
        nudged++;
      }
    }

    // --- PART 2: Nudge clients with pending check-ins ---

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const weeksElapsed = Math.floor(
        (now.getTime() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const currentWeek = weeksElapsed + 1;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      // Check last outbound checkin nudge
      const { data: lastNudge } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .eq('template_name', 'checkin_nudge')
        .order('sent_at', { ascending: false })
        .limit(1);

      const lastNudgeTime = lastNudge?.[0]?.sent_at;
      const hoursSinceNudge = lastNudgeTime
        ? (now.getTime() - new Date(lastNudgeTime).getTime()) / (60 * 60 * 1000)
        : 999;

      if (hoursSinceNudge >= 24) {
        const market = detectMarket(client.phone);
        const isHinglish = market === 'IN';
        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        const body = isHinglish
          ? `Reminder! 📋 Week ${currentWeek} check-in abhi tak pending hai. Jaldi fill karo taaki Maddy next week ka plan bana sake:\n${formUrl}`
          : `Reminder! 📋 Your Week ${currentWeek} check-in is still pending. Fill it out so Maddy can prep your next plan:\n${formUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          body,
          params: [client.name || 'Champion', String(currentWeek)]
        });
        nudged++;
      }
    }

    // --- PART 3: Re-engage dropped leads (7-day rule) ---

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    for (const lead of droppedLeads || []) {
      const { data: reengaged } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (reengaged && reengaged.length > 0) continue;

      const isHinglish = (lead.market || detectMarket(lead.phone)) === 'IN';
      const body = isHinglish
        ? `Hey ${lead.name || 'there'}! Maddy ka naya batch start ho raha hai 🔥 Agar abhi bhi fitness goal pe serious ho, toh $20 trial lelo — no commitment.\n\nhttps://fitnessbymaddy.com/program-trial.html`
        : `Hey ${lead.name || 'there'}! Maddy's new batch is starting 🔥 If you're still serious about your fitness goals, grab the $20 trial — no commitment.\n\nhttps://fitnessbymaddy.com/program-trial.html`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_dropped',
        body,
        params: [lead.name || 'there']
      });
      nudged++;
    }

    return res.json({ ok: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
