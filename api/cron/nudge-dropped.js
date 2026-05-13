const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = Date.now();
    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
    const twoHoursAgo = new Date(now - TWO_HOURS_MS).toISOString();

    // Get leads that were dropped 7+ days ago but had never been nudged post-drop
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;
    for (const lead of droppedLeads) {
      // Check if we've already sent a re-engagement message
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'win_back' : 'win_back_en';

      const result = await sendTemplate(lead.phone, templateName, {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      if (result.ok) {
        await supabase.from('leads').update({
          last_msg_at: new Date().toISOString()
        }).eq('id', lead.id);
        nudged++;
      }
    }

    // Also nudge active clients who haven't submitted check-in
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    if (pendingClients) {
      for (const client of pendingClients) {
        const weekNo = calculateWeekNumber(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        // Check how many days since the check-in was due (Sunday)
        const daysSinceSunday = getDaysSinceLastSunday();
        if (daysSinceSunday !== 1 && daysSinceSunday !== 2) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', String(weekNo), checkinUrl]
        });
        clientNudges++;
      }
    }

    return res.status(200).json({ ok: true, nudged, clientNudges });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNumber(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil((Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1) / 7);
}

function getDaysSinceLastSunday() {
  const now = new Date();
  return now.getDay();
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
