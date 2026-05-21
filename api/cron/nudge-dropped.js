const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNudge } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged2hr = 0;
    if (newLeadsNudge) {
      for (const lead of newLeadsNudge) {
        const templateName = isHinglishMarket(lead.market) ? 'nudge_trial_hi' : 'nudge_trial';
        const result = await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            'https://www.fitnessbymaddy.com/program-trial.html'
          ]
        });
        if (result.ok) nudged2hr++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reengageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', twoHoursAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        const { data: totalMsgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out');

        if (totalMsgs && totalMsgs.length >= 4) continue;

        const market = lead.market || detectMarket(lead.phone);
        const templateName = isHinglishMarket(market) ? 'reengage_hi' : 'reengage';
        const result = await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        if (result.ok) reengaged++;
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

        const { data: pendingCheckins } = await db
          .from('messages')
          .select('body, sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .like('body', '%weekly_checkin%')
          .gte('sent_at', twoDaysAgo)
          .lte('sent_at', yesterday);

        if (pendingCheckins && pendingCheckins.length > 0) {
          const { data: submissions } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .gte('form_submitted_at', twoDaysAgo);

          if (!submissions || submissions.length === 0) {
            await sendTemplate(client.phone, 'checkin_reminder', {
              name: client.name || 'there',
              templateParams: [client.name || 'there']
            });
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged_2hr: nudged2hr,
      dropped,
      reengaged,
      checkin_nudges: checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
