const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_leads: 0, nudged_checkins: 0, errors: 0 };

    await nudgeNewLeads(db, results);
    await nudgeMissedCheckins(db, results);

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeNewLeads(db, results) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('created_at', sevenDaysAgo);

  if (!staleLeads?.length) return;

  for (const lead of staleLeads) {
    try {
      const hoursSince = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSince >= 2 && hoursSince < 6) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake.html?lead=' + lead.id
        ]);
        results.nudged_leads++;
      } else if (hoursSince >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    } catch (err) {
      console.error('Nudge lead error:', err.message);
      results.errors++;
    }
  }
}

async function nudgeMissedCheckins(db, results) {
  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients?.length) return;

  for (const client of clients) {
    try {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('*')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin?.form_submitted_at) continue;

      const dayOfWeek = new Date().getDay();
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      if (dayOfWeek === 1) {
        await sendTemplate(client.phone, 'checkin_reminder_24h', [
          client.name || 'there',
          weekNo.toString(),
          checkinUrl
        ]);
        results.nudged_checkins++;
      } else if (dayOfWeek === 2) {
        await sendTemplate(client.phone, 'checkin_reminder_48h', [
          client.name || 'there',
          weekNo.toString(),
          checkinUrl
        ]);
        results.nudged_checkins++;
      }
    } catch (err) {
      console.error('Nudge checkin error:', err.message);
      results.errors++;
    }
  }
}

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
