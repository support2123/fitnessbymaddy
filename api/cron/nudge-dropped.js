const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  // Re-engage leads that went silent exactly 7 days ago
  // (not dropped by opt-out — only those who never replied)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .gte('created_at', eightDaysAgo)
    .lte('created_at', sevenDaysAgo);

  let reEngaged = 0;

  for (const lead of (staleLeads || [])) {
    // Check we haven't already re-engaged (rate limit will block anyway)
    const hinglish = isHinglish(lead.market || 'IN');
    let msg;

    if (hinglish) {
      msg = `Hey ${lead.name || 'there'}! 👋 Last week message kiya tha — abhi bhi interested ho fitness transformation mein?\n\nMaddy ke paas ek $20 trial session hai — full Zoom call with form correction + plan discussion.\n\nInterested? Bas "trial" likh do! 🎯`;
    } else {
      msg = `Hey ${lead.name || 'there'}! 👋 We reached out last week — still interested in your fitness transformation?\n\nMaddy has a $20 trial session available — a full Zoom call with form correction + plan discussion.\n\nInterested? Just reply "trial"! 🎯`;
    }

    const result = await sendWhatsApp({ phone: lead.phone, body: msg });

    if (result.sent) {
      reEngaged++;
    }
  }

  // Also nudge active clients who haven't submitted check-in
  // (+24hrs and +48hrs after the Sunday send)
  const now = new Date();
  const dayOfWeek = now.getDay();

  // Monday = nudge +24hrs, Tuesday = nudge +48hrs
  if (dayOfWeek === 1 || dayOfWeek === 2) {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil(
        (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!existing) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const name = client.name ? client.name.split(' ')[0] : 'there';
        const nudgeNum = dayOfWeek === 1 ? '1st' : '2nd';

        await sendWhatsApp({
          phone: client.phone,
          body: `Hey ${name}, quick reminder! 📝 Your Week ${weekNo} check-in is still pending.\n\n${checkinUrl}\n\nTakes 2 minutes and helps us fine-tune your next week. 💪`
        });
        clientNudges++;
      }
    }

    return res.status(200).json({
      success: true,
      leads_reengaged: reEngaged,
      client_nudges: clientNudges
    });
  }

  return res.status(200).json({ success: true, leads_reengaged: reEngaged });
};
