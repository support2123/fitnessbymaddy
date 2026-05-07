const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { logMessage, canSendMessage } = require('../../lib/messages');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged_2hr: 0, nudged_24hr: 0, dropped: 0, checkin_nudges: 0 };

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          if (!(await canSendMessage(lead.phone))) continue;

          const market = detectMarket(lead.phone);
          let msg;
          if (market === 'IN') {
            msg = `Hey! Maddy ki team se. Kya aapko $20 zoom trial try karna hai? Ekdum risk-free — results dekhke decide karo.\n\nhttps://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
          } else {
            msg = `Hey! Still thinking? Try our $20 Zoom trial — zero risk, real results. See if it's right for you.\n\nhttps://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
          }

          await sendWhatsApp(lead.phone, 'nudge_trial', [msg]);
          await logMessage(lead.phone, 'out', msg, 'nudge_trial');
          results.nudged_2hr++;
        } catch (err) {
          console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', sevenDaysAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.dropped++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at, template_name')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .in('template_name', ['weekly_checkin', 'checkin_nudge'])
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastMsg) continue;

        const lastSent = new Date(lastMsg.sent_at);
        const hoursSince = (now - lastSent) / (1000 * 60 * 60);

        if (hoursSince >= 24 && hoursSince < 72) {
          if (!(await canSendMessage(client.phone))) continue;

          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          const nudgeMsg = `Reminder: Your Week ${weekNo} check-in is still pending. Submit it so we can keep your progress on track!\n\n${checkinUrl}`;

          await sendWhatsApp(client.phone, 'checkin_nudge', [nudgeMsg]);
          await logMessage(client.phone, 'out', nudgeMsg, 'checkin_nudge');
          results.checkin_nudges++;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false });

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = weekNo; w >= 1; w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          const { data: existingEsc } = await db
            .from('escalations')
            .select('id')
            .eq('client_id', client.id)
            .eq('reason', 'missed_checkins')
            .eq('status', 'pending')
            .single();

          if (!existingEsc) {
            await db.from('escalations').insert({
              phone: client.phone,
              client_id: client.id,
              reason: 'missed_checkins',
              message: `${consecutiveMissed} consecutive missed check-ins (current: Week ${weekNo})`,
              status: 'pending',
            });

            const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
            await sendWhatsApp(maddyPhone, 'escalation_alert', [
              `MISSED CHECK-INS: ${client.name || maskPhone(client.phone)} has missed ${consecutiveMissed} consecutive check-ins. May need outreach.`,
            ]);
          }
        }
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
