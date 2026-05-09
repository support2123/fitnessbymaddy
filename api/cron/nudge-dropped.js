const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // 1) Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudged = 0;

    for (const lead of staleNewLeads || []) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { data: nudges } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (nudges && nudges.length > 0) continue;

      const isIN = lead.market === 'IN';
      const nudgeMsg = isIN
        ? 'Hey! Maddy ka $20 trial session try karo — full workout + nutrition guidance sirf ek session mein. Limited slots!'
        : 'Hey! Try Maddy\'s $20 trial session — a full workout + nutrition guidance in just one session. Limited spots!';

      await sendWhatsApp(lead.phone, nudgeMsg, 'nudge_trial');
      nudged++;
    }

    // 2) Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;

    for (const lead of expiredLeads || []) {
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    // 3) Re-engage dropped leads (7-day rule — one final attempt)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of reengageLeads || []) {
      const { data: reengage } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7d')
        .limit(1);

      if (reengage && reengage.length > 0) continue;

      const isIN = lead.market === 'IN';
      const msg = isIN
        ? 'Hi! Abhi bhi apna fitness goal achieve karna hai? Maddy ke programs abhi available hain — reply karo aur shuru karo!'
        : 'Hi! Still thinking about your fitness goals? Maddy\'s programs are still available — reply and let\'s get started!';

      await sendWhatsApp(lead.phone, msg, 'reengage_7d');
      reengaged++;
    }

    // 4) Nudge active clients who haven't submitted check-in (+24h, +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay(); // 0=Sun
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue; // Mon=+24h, Tue=+48h

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      const link = `${baseUrl}/checkin?c=${client.id}&w=${currentWeek}`;
      const msg = `Reminder: Your Week ${currentWeek} check-in is still pending! Submit here: ${link}`;
      await sendWhatsApp(client.phone, msg);
      clientNudges++;
    }

    return res.status(200).json({ ok: true, nudged, dropped, reengaged, clientNudges });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
