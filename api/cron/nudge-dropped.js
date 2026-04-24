const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../../lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
        console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (count && count > 0) continue;

        const canSend = await canSendToLead(lead.phone);
        if (!canSend) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reEngaged++;
        console.log(`Re-engage sent: ${maskPhone(lead.phone)}`);
      }
    }

    const { data: missedCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    let escalations = 0;
    if (missedCheckins) {
      for (const client of missedCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (recentCheckins || []).map((c) => c.week_no);
        const missedCount = [currentWeek, currentWeek - 1]
          .filter((w) => w > 0 && !submittedWeeks.includes(w)).length;

        if (missedCount >= 2) {
          await sendText(MADDY_PHONE,
            `⚠️ ${client.name || maskPhone(client.phone)} has missed 2 consecutive check-ins. Please reach out.`
          );
          escalations++;
        } else if (missedCount === 1) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendText(client.phone,
            `Hey ${client.name || 'there'}! 👋 Reminder to submit your Week ${currentWeek} check-in:\n${checkinUrl}\n\nYour progress matters — don't skip it! 💪`
          );
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reEngaged,
      checkinNudges,
      escalations,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
