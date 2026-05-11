const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendMessage } = require('../lib/whatsapp');
const { canSendMessage, logMessage } = require('../lib/ratelimit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge leads who haven't replied in 2 hours (new leads)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const results = { nudged: 0, dropped: 0, reengaged: 0 };

  // Drop leads silent for 24+ hours
  const { data: silentLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  if (silentLeads) {
    for (const lead of silentLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.dropped++;
    }
  }

  // Nudge new leads who haven't replied in 2hrs but less than 24hrs
  const { data: nudgeLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gte('last_msg_at', twentyFourHoursAgo);

  if (nudgeLeads) {
    for (const lead of nudgeLeads) {
      if (!(await canSendMessage(lead.phone))) continue;

      const market = lead.market || 'GLOBAL';
      const msg = market === 'IN'
        ? `Hey! Maddy ka $20 trial try karna chahoge? Full Zoom session milega 🔥 Limited spots hai.`
        : `Hey! Want to try Maddy's $20 trial? Full Zoom session included 🔥 Limited spots.`;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      await logMessage(lead.phone, 'out', msg, 'nudge_trial');
      results.nudged++;
    }
  }

  // Re-engage dropped leads after 7 days (one final attempt)
  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', sevenDaysAgo)
    .lt('last_msg_at', new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString());

  if (droppedLeads) {
    for (const lead of droppedLeads) {
      if (!(await canSendMessage(lead.phone))) continue;

      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7d');

      if (count && count > 0) continue;

      const msg = `Still thinking about your fitness goals? We've got a special offer this week — reply to know more!`;
      await sendTemplate(lead.phone, 'reengage_7d', [lead.name || 'there']);
      await logMessage(lead.phone, 'out', msg, 'reengage_7d');
      results.reengaged++;
    }
  }

  // Nudge active clients who missed check-in (+24hrs and +48hrs)
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      // Sunday = 0, Monday = 1, Tuesday = 2
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        if (!(await canSendMessage(client.phone))) continue;
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        const url = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;
        const msg = `Reminder: Your Week ${weekNo} check-in is pending! Fill it quick: ${url}`;
        await sendMessage(client.phone, msg);
        await logMessage(client.phone, 'out', msg, 'checkin_nudge');
      }

      // 2 consecutive missed check-ins → escalate
      if (weekNo >= 2) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin && dayOfWeek >= 3) {
          await sendMessage('917082478374',
            `⚠️ Client ${client.name || client.phone} has missed 2 consecutive check-ins (Weeks ${weekNo - 1} & ${weekNo}).`
          );
        }
      }
    }
  }

  return res.status(200).json(results);
};
