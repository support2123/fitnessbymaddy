const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_CRON) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: nudge2hr } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (nudge2hr) {
      for (const lead of nudge2hr) {
        try {
          const template = isHinglish(lead.market) ? 'nudge_trial' : 'nudge_trial_en';
          await sendTemplate(lead.phone, template, [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake.html?lead=' + lead.id
          ]);
          nudged++;
        } catch (err) {
          console.error(`[Nudge] 2hr nudge failed for ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: dropLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString());

    let dropped = 0;

    if (dropLeads) {
      for (const lead of dropLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        try {
          const template = isHinglish(lead.market) ? 'reengage_v1' : 'reengage_v1_en';
          await sendTemplate(lead.phone, template, [lead.name || 'there']);
          reEngaged++;
        } catch (err) {
          console.error(`[Nudge] Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at || now);
        const weekNo = Math.floor((now - startDate) / (1000 * 60 * 60 * 24 * 7)) + 1;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          const { count } = await db
            .from('checkins')
            .select('id', { count: 'exact' })
            .eq('client_id', client.id)
            .is('form_submitted_at', null);

          if (count && count >= 2) {
            const { sendToMaddy } = require('../../lib/whatsapp');
            await sendToMaddy(
              `Client ${client.name || maskPhone(client.phone)} has missed 2+ consecutive check-ins. Please follow up.`
            );
          }
        }
      }
    }

    return res.status(200).json({
      nudged_2hr: nudged,
      dropped_24hr: dropped,
      re_engaged: reEngaged,
      checkin_nudges: checkinNudges
    });
  } catch (err) {
    console.error('[Cron/Nudge] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
