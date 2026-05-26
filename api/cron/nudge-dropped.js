const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    let nudged = 0;

    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const hinglish = isHinglish(lead.market);
        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial session try karna chahoge? Ek Zoom call mein poora plan milega. Interested? Reply karo "trial" aur link bhejte hain!`
          : `Hey ${lead.name || 'there'}! Want to try Maddy's $20 trial session? Get a full plan in one Zoom call. Interested? Reply "trial" and we'll send you the link!`;

        const result = await sendWhatsApp(lead.phone, msg, 'nudge_trial');
        if (result.sent) nudged++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo)
      .lt('created_at', sevenDaysAgo);

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (lastMsg) {
          const hoursSince = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (60 * 60 * 1000);
          if (hoursSince < 24) continue;
        }

        const hinglish = isHinglish(client.leads?.market || 'GLOBAL');
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const msg = hinglish
          ? `Reminder: Week ${weekNo} ka check-in abhi pending hai. Jaldi fill karo:\n${checkinUrl}`
          : `Reminder: Your Week ${weekNo} check-in is still pending. Please fill it out:\n${checkinUrl}`;

        const result = await sendWhatsApp(client.phone, msg, null);
        if (result.sent) checkinNudges++;
      }
    }

    return res.json({ nudged, checkin_nudges: checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
