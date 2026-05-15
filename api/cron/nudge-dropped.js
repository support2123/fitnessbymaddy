const { supabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const results = [];

    // Re-engage leads that went silent (no reply in 2 hrs but < 24 hrs)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (silentLeads || [])) {
      const { data: outMessages } = await supabase
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .like('template_name', 'nudge%');

      if (outMessages && outMessages.length >= 1) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';

      const sendResult = await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/intake'
      ]);

      results.push({
        phone: maskPhone(lead.phone),
        action: 'nudge_sent',
        success: sendResult.success
      });
    }

    // Mark leads as dropped if no reply in 24 hrs
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      results.push({ phone: maskPhone(lead.phone), action: 'marked_dropped' });
    }

    // Nudge active clients who haven't submitted check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = new Date().getDay();
      // Nudge on Tuesday (day after Sunday send) and Wednesday
      if (dayOfWeek !== 2 && dayOfWeek !== 3) continue;

      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, templateName, [
        client.name || 'Champion',
        String(weekNo),
        checkinUrl
      ], true);

      results.push({
        client: maskPhone(client.phone),
        action: 'checkin_nudge',
        week: weekNo
      });
    }

    // Check for 2 consecutive missed check-ins
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

      if (currentWeek < 3) continue;

      const { data: lastTwo } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .in('week_no', [currentWeek - 1, currentWeek - 2]);

      if (!lastTwo || lastTwo.length === 0) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nMissed weeks ${currentWeek - 2} and ${currentWeek - 1}`
        );
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
