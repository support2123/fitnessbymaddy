const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { isHinglishMarket, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, missed_checkin_alerts: 0 };

  try {
    // Re-engage leads that went silent 2-24 hrs ago (still status=new)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    if (silentLeads) {
      for (const lead of silentLeads) {
        try {
          const allowed = await canSendMessage(lead.phone);
          if (!allowed) {
            results.skipped++;
            continue;
          }

          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          results.nudged++;
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    // Drop leads that haven't replied in 24+ hrs
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const expectedWeek = Math.ceil(daysSinceStart / 7);

        if (expectedWeek < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastCheckinWeek = recentCheckins && recentCheckins.length > 0
          ? recentCheckins[0].week_no : 0;

        if (expectedWeek - lastCheckinWeek >= 2) {
          const { sendTemplate: st, notifyMaddy } = require('../_lib/whatsapp');
          await notifyMaddy(
            `2 consecutive missed check-ins (week ${lastCheckinWeek + 1} & ${lastCheckinWeek + 2})`,
            client.phone,
            `Client: ${client.name || 'Unknown'}`
          );
          results.missed_checkin_alerts++;
        }
      }
    }

    return res.status(200).json({ message: 'Nudge cron completed', ...results });

  } catch (err) {
    console.error('Cron nudge-dropped error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
