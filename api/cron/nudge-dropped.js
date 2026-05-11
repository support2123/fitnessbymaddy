const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ action: 'no_leads_to_nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_reengagement')
        .limit(1);

      if (recentMessages && recentMessages.length > 0) {
        results.push({ lead_id: lead.id, action: 'already_nudged' });
        continue;
      }

      const market = lead.market || detectMarket(lead.phone);

      await sendTemplate(lead.phone, 'nudge_reengagement', {
        name: lead.name || 'there',
        templateParams: market === 'IN'
          ? [
              lead.name || 'there',
              'Abhi bhi ready ho? Maddy ka $20 trial session try karo — koi commitment nahi!',
              'https://fitnessbymaddy.com/shred.html'
            ]
          : [
              lead.name || 'there',
              'Still thinking? Try Maddy\'s $20 trial session — no commitment needed!',
              'https://fitnessbymaddy.com/shred.html'
            ]
      });

      results.push({ lead_id: lead.id, action: 'nudged' });
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = Math.ceil((Date.now() - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const { data: lastMsg } = await db
            .from('messages')
            .select('sent_at')
            .eq('phone', client.phone)
            .eq('template_name', 'weekly_checkin')
            .order('sent_at', { ascending: false })
            .limit(1)
            .single();

          if (lastMsg && new Date(lastMsg.sent_at) < new Date(twoDaysAgo)) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

            await sendTemplate(client.phone, 'checkin_reminder', {
              name: client.name || 'there',
              templateParams: [
                client.name || 'there',
                `Week ${weekNo}`,
                checkinUrl
              ]
            });

            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      leads_nudged: results.filter(r => r.action === 'nudged').length,
      checkin_nudges: checkinNudges,
      total_processed: results.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function isVercelCron(req) {
  return req.headers['user-agent']?.includes('vercel-cron');
}
