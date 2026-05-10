const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    if (!process.env.VERCEL) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getSupabase();
  const results = { nudged_new: 0, nudged_trial: 0, skipped: 0 };

  try {
    const now = new Date();

    // FLOW A nudge: New leads with no reply after 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const { data: newLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString());

    for (const lead of (newLeads || [])) {
      try {
        // Check if we already sent a nudge (check messages)
        const { data: nudges } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) {
          // Already nudged — check if 24hr mark passed → drop
          const leadAge = now - new Date(lead.created_at);
          if (leadAge > 24 * 60 * 60 * 1000) {
            await db.from('leads')
              .update({ status: 'dropped' })
              .eq('id', lead.id);
          }
          results.skipped++;
          continue;
        }

        // Send trial nudge
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);

        await db.from('messages').insert({
          phone: lead.phone,
          direction: 'out',
          body: 'Trial nudge sent',
          template_name: 'nudge_trial',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        results.nudged_trial++;
      } catch (e) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, e.message);
      }
    }

    // Re-engage dropped leads (7-day rule: only if dropped within last 7 days)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const { data: recentDropped } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo.toISOString());

    for (const lead of (recentDropped || [])) {
      try {
        // Only re-engage once — check if re-engage msg was sent
        const { data: reengages } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7d')
          .limit(1);

        if (reengages && reengages.length > 0) {
          results.skipped++;
          continue;
        }

        await sendTemplate(lead.phone, 'reengage_7d', [lead.name || 'there']);

        await db.from('messages').insert({
          phone: lead.phone,
          direction: 'out',
          body: 'Re-engagement message sent',
          template_name: 'reengage_7d',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        results.nudged_new++;
      } catch (e) {
        console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, e.message);
      }
    }

    // Nudge clients who haven't submitted check-in (+24hr, +48hr)
    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      try {
        const started = new Date(client.program_started_at);
        const diffDays = Math.floor((now - started) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(diffDays / 7) + 1;

        const { data: checkin } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        // Check if it's Sunday+1 (Monday) or Sunday+2 (Tuesday)
        const dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const nudgeTemplate = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';

        // Don't double-nudge
        const { data: existingNudge } = await db.from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', nudgeTemplate)
          .gt('sent_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existingNudge && existingNudge.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, nudgeTemplate, [
          client.name || 'Champion',
          checkinUrl,
        ]);

        await db.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: `Check-in nudge (${nudgeTemplate})`,
          template_name: nudgeTemplate,
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      } catch (e) {
        console.error(`Client nudge failed for ${maskPhone(client.phone)}:`, e.message);
      }
    }

    console.log(`Nudge cron: ${JSON.stringify(results)}`);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
