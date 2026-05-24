const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendWhatsAppText, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = Date.now();
    let nudged = 0;
    let dropped = 0;

    // 1. Nudge new leads who haven't replied in 2 hours (send trial link)
    const twoHoursAgo = new Date(now - TWO_HOURS_MS).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    for (const lead of staleNewLeads || []) {
      const ageMs = now - new Date(lead.created_at).getTime();

      if (ageMs > TWENTY_FOUR_HOURS_MS) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        continue;
      }

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = lead.market || detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'nudge_trial' : 'nudge_trial_en';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      nudged++;
    }

    // 2. Re-engage dropped leads within 7-day window (max once)
    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
    const { data: recentDropped } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    for (const lead of recentDropped || []) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = lead.market || detectMarket(lead.phone);
      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'reengage_7day' : 'reengage_7day_en';
      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      nudged++;
    }

    // 3. Nudge active clients with pending check-ins (+24hrs, +48hrs)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const weeksActive = Math.ceil(
        (now - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksActive < 1) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksActive)
        .limit(1)
        .single();

      if (checkin) continue;

      const sundayThisWeek = new Date();
      sundayThisWeek.setDate(sundayThisWeek.getDate() - sundayThisWeek.getDay());
      sundayThisWeek.setHours(3, 30, 0, 0);
      const hoursSinceSunday = (now - sundayThisWeek.getTime()) / (60 * 60 * 1000);

      if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksActive}`;
        await sendWhatsAppText(client.phone,
          `Reminder: Your Week ${weeksActive} check-in is still pending. Please submit it here: ${checkinUrl}`
        );
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
