const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { getLanguage } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();

    // FLOW A nudges: leads with status=new who haven't replied
    // 2-hour nudge for trial
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .is('program_interest', null);

    let nudgeCount = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at);

        if ((count || 0) > 0) continue;

        const hoursSinceCreation = (now - new Date(lead.created_at)) / (1000 * 60 * 60);

        if (hoursSinceCreation >= 24) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          continue;
        }

        if (hoursSinceCreation >= 2) {
          const lang = getLanguage(lead.market);
          const template = lang === 'hinglish' ? 'nudge_trial_hi' : 'nudge_trial';
          await sendTemplate(lead.phone, template, [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake',
          ]);
          nudgeCount++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reEngageCount = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count: reEngageAttempts } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .eq('direction', 'out');

        if ((reEngageAttempts || 0) > 0) continue;

        const lang = getLanguage(lead.market);
        const template = lang === 'hinglish' ? 'reengage_7day_hi' : 'reengage_7day';
        await sendTemplate(lead.phone, template, [lead.name || 'there']);
        reEngageCount++;
      }
    }

    // Nudge active clients who haven't submitted check-ins
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudgeCount = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const { data: lastCheckinMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'weekly_checkin')
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastCheckinMsg) continue;

        const sentAt = new Date(lastCheckinMsg.sent_at);
        const hoursSinceSent = (now - sentAt) / (1000 * 60 * 60);

        if (hoursSinceSent >= 24 && hoursSinceSent < 48) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge_24h', [
            client.name || 'there',
            checkinUrl,
          ]);
          checkinNudgeCount++;
        } else if (hoursSinceSent >= 48 && hoursSinceSent < 72) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge_48h', [
            client.name || 'there',
            checkinUrl,
          ]);
          checkinNudgeCount++;
        }
      }
    }

    return res.status(200).json({
      nudged: nudgeCount,
      re_engaged: reEngageCount,
      checkin_nudges: checkinNudgeCount,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
