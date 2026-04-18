const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone, RATE_LIMIT_MS } = require('../../lib/whatsapp');

const NUDGE_WINDOW_HOURS = 2;
const NUDGE_WINDOW_MS = NUDGE_WINDOW_HOURS * 60 * 60 * 1000;
const DROP_AFTER_HOURS = 24;
const DROP_AFTER_MS = DROP_AFTER_HOURS * 60 * 60 * 1000;
const RE_ENGAGE_AFTER_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, dropped: 0, re_engaged: 0, errors: 0 };

  try {
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new');

    const now = Date.now();

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          const createdAt = new Date(lead.created_at).getTime();
          const age = now - createdAt;

          if (age > DROP_AFTER_MS) {
            await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
            results.dropped++;
            continue;
          }

          if (age > NUDGE_WINDOW_MS) {
            const { data: lastOut } = await db
              .from('messages')
              .select('sent_at, template_name')
              .eq('phone', lead.phone)
              .eq('direction', 'out')
              .order('sent_at', { ascending: false })
              .limit(1)
              .single();

            const canNudge = !lastOut ||
              (now - new Date(lastOut.sent_at).getTime() > RATE_LIMIT_MS) &&
              lastOut.template_name !== 'nudge_trial';

            if (canNudge) {
              await sendTemplate(lead.phone, 'nudge_trial', [
                lead.name || 'there',
                'https://fitnessbymaddy.com/program-trial.html',
              ]);

              await db.from('messages').insert({
                phone: lead.phone,
                direction: 'out',
                body: 'Nudge: Try $20 trial session',
                template_name: 'nudge_trial',
                sent_at: new Date().toISOString(),
                status: 'sent',
              });

              results.nudged++;
            }
          }
        } catch (leadErr) {
          console.error(`Nudge error for ${maskPhone(lead.phone)}:`, leadErr.message);
          results.errors++;
        }
      }
    }

    const sevenDaysAgo = new Date(now - RE_ENGAGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - (RE_ENGAGE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        try {
          const { count } = await db
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('phone', lead.phone)
            .eq('template_name', 're_engage');

          if (count && count > 0) continue;

          await sendTemplate(lead.phone, 're_engage', [
            lead.name || 'there',
          ]);

          await db.from('messages').insert({
            phone: lead.phone,
            direction: 'out',
            body: 'Re-engagement attempt',
            template_name: 're_engage',
            sent_at: new Date().toISOString(),
            status: 'sent',
          });

          results.re_engaged++;
        } catch (reErr) {
          console.error(`Re-engage error for ${maskPhone(lead.phone)}:`, reErr.message);
          results.errors++;
        }
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        try {
          const startDate = new Date(client.program_started_at);
          const daysSinceStart = Math.floor((now - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const currentWeek = Math.ceil(daysSinceStart / 7);

          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', currentWeek)
            .single();

          if (checkin) continue;

          const dayOfWeek = new Date().getDay();
          if (dayOfWeek === 1 || dayOfWeek === 2) {
            const token = Buffer.from(`${client.id}-${currentWeek}`).toString('base64');
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}&t=${token}`;

            const { data: lastNudge } = await db
              .from('messages')
              .select('sent_at')
              .eq('phone', client.phone)
              .eq('template_name', 'checkin_nudge')
              .order('sent_at', { ascending: false })
              .limit(1)
              .single();

            const canNudge = !lastNudge || (now - new Date(lastNudge.sent_at).getTime() > 24 * 60 * 60 * 1000);

            if (canNudge) {
              await sendTemplate(client.phone, 'checkin_nudge', [
                client.name || 'there',
                checkinUrl,
              ]);

              await db.from('messages').insert({
                phone: client.phone,
                direction: 'out',
                body: `Check-in nudge for week ${currentWeek}`,
                template_name: 'checkin_nudge',
                sent_at: new Date().toISOString(),
                status: 'sent',
              });
            }
          }
        } catch (nudgeErr) {
          console.error(`Checkin nudge error for ${maskPhone(client.phone)}:`, nudgeErr.message);
        }
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
