const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    // Re-engage leads that went silent 2 hours ago (no reply to welcome)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Nudge: 2hr no-reply leads (send trial link)
    const { data: silentLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of silentLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { data: nudges } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (nudges && nudges.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: hinglish
          ? ['Ek $20 trial session se start karo — Maddy ke saath live Zoom workout!', 'https://fitnessbymaddy.com/program-trial.html']
          : ['Start with a $20 trial session — a live Zoom workout with Maddy!', 'https://fitnessbymaddy.com/program-trial.html']
      });

      nudged++;
    }

    // Drop: 24hr no-reply leads
    const { data: deadLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    for (const lead of deadLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    // Nudge active clients with pending check-ins (24hr and 48hr)
    let clientNudges = 0;
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const { data: lastSent } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('template_name', 'weekly_checkin')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (!lastSent || lastSent.length === 0) continue;

      const hoursSinceSent = (Date.now() - new Date(lastSent[0].sent_at).getTime()) / (60 * 60 * 1000);

      if (hoursSinceSent >= 24 && hoursSinceSent < 48) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [String(weekNo), checkinUrl]
        });
        clientNudges++;
      } else if (hoursSinceSent >= 48 && hoursSinceSent < 72) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_final_reminder', {
          name: client.name || 'there',
          templateParams: [String(weekNo), checkinUrl]
        });
        clientNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      leads_nudged: nudged,
      leads_dropped: dropped,
      client_nudges: clientNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
}
