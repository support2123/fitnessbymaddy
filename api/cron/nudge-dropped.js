const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = { nudged_leads: 0, nudged_checkins: 0, escalated: 0, errors: 0 };

    await nudgeNewLeads(results);
    await nudgeMissedCheckins(results);

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function nudgeNewLeads(results) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  if (staleLeads) {
    for (const lead of staleLeads) {
      try {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html'
          ]
        });
        results.nudged_leads++;
      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
        results.errors++;
      }
    }
  }

  const { data: deadLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  if (deadLeads && deadLeads.length > 0) {
    const ids = deadLeads.map(l => l.id);
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .in('id', ids);
  }

  const { data: reEngageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('created_at', sevenDaysAgo);

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      try {
        const { data: recentNudges } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (recentNudges && recentNudges.length > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        results.nudged_leads++;
      } catch (err) {
        results.errors++;
      }
    }
  }
}

async function nudgeMissedCheckins(results) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .not('program_started_at', 'is', null);

  if (!activeClients) return;

  for (const client of activeClients) {
    try {
      const weekNo = getCurrentWeek(client.program_started_at);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (checkin) continue;

      const { data: sentNudges } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .like('template_name', 'checkin_nudge%')
        .gte('sent_at', twoDaysAgo)
        .order('sent_at', { ascending: false });

      const nudgeCount = sentNudges?.length || 0;

      if (nudgeCount >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)}\nName: ${client.name}\nWeek: ${weekNo}\nProgram: ${client.program}`
        );
        results.escalated++;
        continue;
      }

      const token = generateToken(client.id, weekNo);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}&t=${token}`;

      await sendTemplate(client.phone, `checkin_nudge_${nudgeCount + 1}`, {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinUrl]
      });
      results.nudged_checkins++;
    } catch (err) {
      console.error(`Checkin nudge error for ${maskPhone(client.phone)}:`, err.message);
      results.errors++;
    }
  }
}

function getCurrentWeek(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function generateToken(clientId, weekNo) {
  const raw = `${clientId}-${weekNo}-${process.env.SUPABASE_SERVICE_KEY?.slice(0, 8) || 'salt'}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
