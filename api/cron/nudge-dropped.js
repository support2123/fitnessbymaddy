const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads that went silent 2 hours ago (new leads only)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo.toISOString())
      .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .like('template_name', 'nudge%')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? `Hey! 👋 Maddy ke $20 trial session try karo — ek Zoom call mein full guidance milegi. Koi commitment nahi.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`
          : `Hey! 👋 Try Maddy's $20 trial session — full guidance in one Zoom call. No commitment.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        }, msg);

        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo.toISOString());

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .limit(2);

        if (replies && replies.length <= 1) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engage dropped leads after 7 days (one-time only)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', eightDaysAgo.toISOString())
      .lte('created_at', sevenDaysAgo.toISOString());

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMsgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .like('template_name', 'reengage%')
          .limit(1);

        if (reEngageMsgs && reEngageMsgs.length > 0) continue;

        const market = lead.market || 'IN';
        const msg = market === 'IN'
          ? `Hey ${lead.name || 'there'}! Still thinking about your fitness goals? 🤔 Maddy ke programs mein limited spots hain. $20 trial se start karo — koi commitment nahi.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`
          : `Hey ${lead.name || 'there'}! Still thinking about your fitness goals? 🤔 Limited spots in Maddy's programs. Start with a $20 trial — no commitment.\n\nhttps://www.fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp(lead.phone, 'reengage_7day', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        }, msg);

        reEngaged++;
      }
    }

    // Nudge clients who haven't submitted check-ins (+24h and +48h)
    const { data: pendingCheckins } = await supabase
      .from('checkins')
      .select('*, clients!inner(phone, name, lead_id)')
      .is('weight', null)
      .not('token', 'is', null);

    let checkinNudged = 0;

    if (pendingCheckins) {
      for (const checkin of pendingCheckins) {
        const created = new Date(checkin.created_at);
        const hoursSince = (now - created) / (1000 * 60 * 60);

        if (hoursSince < 24) continue;
        if (hoursSince > 72) continue;

        const nudgeType = hoursSince >= 48 ? '48h' : '24h';

        const { data: nudgeMsgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', checkin.clients.phone)
          .eq('direction', 'out')
          .like('template_name', `checkin_nudge_${nudgeType}%`)
          .gte('sent_at', created.toISOString())
          .limit(1);

        if (nudgeMsgs && nudgeMsgs.length > 0) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}&t=${checkin.token}`;

        await sendWhatsApp(checkin.clients.phone, `checkin_nudge_${nudgeType}`, {
          name: checkin.clients.name,
          templateParams: [checkin.clients.name, String(checkin.week_no)]
        }, `Reminder: Week ${checkin.week_no} check-in pending! ${checkinUrl}`);

        checkinNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reEngaged,
      checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
