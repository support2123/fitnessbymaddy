const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    let nudged = 0;

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads && staleLeads.length > 0) {
      for (const lead of staleLeads) {
        const hoursSinceMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (60 * 60 * 1000);

        if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            params: [lead.name || 'there'],
          });
          nudged++;
        } else if (hoursSinceMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        }

        if (nudged % 10 === 0 && nudged > 0) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    const { data: missedCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (missedCheckins) {
      const today = new Date();
      const dayOfWeek = today.getDay();

      if (dayOfWeek >= 2) {
        for (const client of missedCheckins) {
          const startDate = new Date(client.program_started_at);
          const weekNo = Math.ceil((today - startDate) / (7 * 24 * 60 * 60 * 1000));

          if (weekNo < 1) continue;

          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();

          if (!checkin) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

            const nudgeDays = dayOfWeek - 1;
            if (nudgeDays === 1 || nudgeDays === 2) {
              await sendWhatsApp({
                phone: client.phone,
                templateName: 'checkin_nudge',
                params: [client.name || 'there', String(weekNo), checkinUrl],
              });
              nudged++;
            }
          }
        }
      }
    }

    console.log(`[CRON NUDGE] nudged=${nudged}`);
    return res.status(200).json({ nudged });
  } catch (err) {
    console.error('[CRON NUDGE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
