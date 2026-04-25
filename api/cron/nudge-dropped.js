const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendToLead } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const SITE = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();
    const now = Date.now();
    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
    const fourteenDaysAgo = new Date(now - FOURTEEN_DAYS_MS).toISOString();

    const { data: droppedLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    let skipped = 0;

    for (const lead of (droppedLeads || [])) {
      const { data: alreadyNudged } = await sb
        .from('nudges')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('nudge_type', 'dropped_reengagement')
        .single();

      if (alreadyNudged) {
        skipped++;
        continue;
      }

      const canSend = await canSendToLead(lead.phone);
      if (!canSend) {
        skipped++;
        continue;
      }

      const hinglish = isHinglish(lead.market);
      const trialUrl = `${SITE}/shred.html`;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: hinglish
          ? [lead.name || 'there', 'Maddy ka $20 trial session try karo — koi commitment nahi!', trialUrl]
          : [lead.name || 'there', "Try Maddy's $20 trial session — no commitment!", trialUrl]
      });

      await sb.from('nudges').insert({
        lead_id: lead.id,
        nudge_type: 'dropped_reengagement',
        sent_at: new Date().toISOString()
      });

      reEngaged++;
    }

    await nudgeMissedCheckins(sb);

    console.log(`[nudge-dropped] Re-engaged: ${reEngaged}, Skipped: ${skipped}`);
    return res.status(200).json({ ok: true, reEngaged, skipped });

  } catch (err) {
    console.error(`[nudge-dropped] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeMissedCheckins(sb) {
  const { data: activeClients } = await sb
    .from('clients')
    .select('*')
    .eq('status', 'active');

  for (const client of (activeClients || [])) {
    const weekNo = calculateWeekNo(client.program_started_at);
    if (weekNo < 1) continue;

    const { data: checkin } = await sb
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (checkin) continue;

    const { data: recentNudges } = await sb
      .from('nudges')
      .select('*')
      .eq('client_id', client.id)
      .eq('nudge_type', `checkin_nudge_w${weekNo}`)
      .order('sent_at', { ascending: false })
      .limit(1);

    const nudgeCount = recentNudges ? recentNudges.length : 0;
    if (nudgeCount >= 2) {
      const { data: prevWeekCheckin } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo - 1)
        .single();

      if (!prevWeekCheckin) {
        await sb.from('escalations').insert({
          phone: client.phone,
          reason: '2 consecutive missed check-ins',
          context: `Client ${client.id}, weeks ${weekNo - 1} and ${weekNo}`
        });
      }
      continue;
    }

    const checkinUrl = `${process.env.SITE_URL || 'https://www.fitnessbymaddy.com'}/checkin.html?c=${client.id}&w=${weekNo}`;

    await sendTemplate(client.phone, 'checkin_reminder', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(weekNo), checkinUrl]
    });

    await sb.from('nudges').insert({
      client_id: client.id,
      nudge_type: `checkin_nudge_w${weekNo}`,
      sent_at: new Date().toISOString()
    });
  }
}

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
