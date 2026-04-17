const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    // Re-engage leads that went silent (no reply in 2hrs from welcome)
    // but haven't been contacted in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Find new leads with no recent outbound messages
    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    if (!stalledLeads || stalledLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of stalledLeads) {
      // Check if we've already sent a nudge recently
      const { data: recentMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(2);

      // Allow up to 2 follow-ups total (welcome + 1 nudge)
      if (recentMessages && recentMessages.length >= 2) {
        // Max nudges sent, mark as dropped
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake.html'
        ]
      });

      nudged++;
    }

    // Also nudge active clients who haven't submitted check-ins
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    for (const client of (pendingCheckins || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay(); // 0 = Sunday

      // Only nudge Mon (1) and Tue (2) after Sunday check-in window
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'checkin_reminder', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]
      });

      clientNudges++;
    }

    return res.status(200).json({
      ok: true,
      lead_nudges: nudged,
      client_nudges: clientNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
