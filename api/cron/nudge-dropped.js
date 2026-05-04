const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('template_name')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) continue;

        const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';
        const msg = isHinglish(lead.market)
          ? `Hey! Abhi bhi soch rahe ho? Maddy ka $20 trial try karo - risk free: ${trialUrl}`
          : `Still thinking? Try Maddy's $20 trial session - completely risk free: ${trialUrl}`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there'],
          body: msg,
        });
        nudged++;
      }
    }

    // FLOW A step 4: drop leads who haven't replied in 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Nudge active clients with missing check-ins (24h and 48h)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = Math.floor(
          (now - new Date(client.program_started_at)) / (7 * 24 * 60 * 60 * 1000)
        ) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const sundayThisWeek = new Date(now);
        sundayThisWeek.setDate(now.getDate() - now.getDay());
        sundayThisWeek.setHours(3, 30, 0, 0);

        const hoursSinceSunday = (now - sundayThisWeek) / (60 * 60 * 1000);

        if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp({
            phone: client.phone,
            templateName: 'checkin_reminder',
            params: [client.name || 'there', String(weekNo)],
            body: `Reminder: Your Week ${weekNo} check-in is pending! Fill it out here: ${checkinUrl}`,
          });
          clientNudges++;
        }

        // Escalate if 2+ consecutive missed check-ins
        if (weekNo >= 3) {
          const { data: recentCheckins } = await db
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .gte('week_no', weekNo - 2)
            .lte('week_no', weekNo);

          if (!recentCheckins || recentCheckins.length === 0) {
            await sendWhatsApp({
              phone: process.env.MADDY_PHONE || '+917082478374',
              templateName: 'escalation_alert',
              params: [
                client.name || 'Unknown',
                `2+ consecutive missed check-ins (Week ${weekNo})`,
              ],
            });
          }
        }
      }
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      dropped,
      clientNudges,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
