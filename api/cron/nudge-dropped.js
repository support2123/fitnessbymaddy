const { supabase } = require('../_lib/supabase');
const { sendWithRateLimit } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isVercelCron && !isInternal && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lte('last_msg_at', twoDaysAgo.toISOString())
      .gte('created_at', sevenDaysAgo.toISOString());

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const createdAt = new Date(lead.created_at);
        const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreation >= 24 * 7) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
          continue;
        }

        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const result = await sendWithRateLimit(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);

        if (result.ok) nudged++;
      }
    }

    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, program_interest, last_msg_at')
      .eq('status', 'qualified')
      .lte('last_msg_at', twoDaysAgo.toISOString())
      .gte('created_at', sevenDaysAgo.toISOString());

    if (qualifiedLeads) {
      for (const lead of qualifiedLeads) {
        const result = await sendWithRateLimit(lead.phone, 'nudge_checkout', [
          lead.name || 'there',
          lead.program_interest || 'your program'
        ]);

        if (result.ok) nudged++;
      }
    }

    const activeClients = await nudgeMissedCheckins();

    console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${activeClients} client nudges`);
    return res.status(200).json({ ok: true, nudged, dropped, client_nudges: activeClients });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeMissedCheckins() {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return 0;

  let nudgeCount = 0;
  const now = new Date();

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    const { data: lastCheckin } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCheckin && lastCheckin.week_no >= currentWeek) continue;

    const { data: lastMsg } = await supabase
      .from('messages')
      .select('sent_at')
      .eq('phone', client.phone)
      .eq('direction', 'out')
      .ilike('body', '%checkin%')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg) {
      const hoursSinceNudge = (now - new Date(lastMsg.sent_at)) / (1000 * 60 * 60);
      if (hoursSinceNudge < 24) continue;
    }

    const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
    await sendWithRateLimit(client.phone, 'checkin_nudge', [
      client.name || 'Champion',
      formUrl
    ], true);

    nudgeCount++;
  }

  return nudgeCount;
}
