const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { getLanguage } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find leads that went silent 2+ hours ago (for auto-nudge)
    // and leads dropped exactly 7 days ago (for re-engagement)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    let nudged = 0;
    let dropped = 0;
    let reEngaged = 0;

    // 1. Nudge new leads with no reply after 2 hours
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    if (silentLeads) {
      for (const lead of silentLeads) {
        // Check if we already nudged (look for nudge template in messages)
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if (count === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', {
            name: lead.name || 'there',
            templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/shred.html']
          });
          nudged++;
        }
      }
    }

    // 2. Drop leads with no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // 3. Re-engage dropped leads from 7 days ago (one-time attempt)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', eightDaysAgo.toISOString());

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const lang = getLanguage(lead.market);
        const templateName = lang === 'hinglish' ? 'reengage_hindi' : 'reengage_en';
        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        reEngaged++;
      }
    }

    // 4. Send +24hr and +48hr nudges for active clients who haven't submitted check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysDiff / 7) + 1;
        const dayOfWeek = now.getDay(); // 0=Sun

        // Nudge on Monday (+24h) and Tuesday (+48h) if check-in not submitted
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const { count } = await supabase
            .from('checkins')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .eq('week_no', weekNo);

          if (count === 0) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_reminder', {
              name: client.name,
              isClient: true,
              templateParams: [client.name, checkinUrl]
            });
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reEngaged,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
