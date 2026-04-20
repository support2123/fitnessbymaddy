import supabase from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { isHinglish } from '../_lib/market.js';
import { maskPhone } from '../_lib/mask.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = Date.now();
    const results = { nudged_2hr: 0, dropped_24hr: 0, reengaged_7day: 0 };

    // 1. Nudge leads with no reply after 2 hours
    const twoHoursAgo = new Date(now - TWO_HOURS_MS).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    for (const lead of (staleNewLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count > 0) continue;

      const nudgeCount = await getOutboundCount(lead.phone, lead.created_at);
      if (nudgeCount >= 2) continue;

      const hinglish = isHinglish(lead.phone);
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
      const params = hinglish
        ? [`Hey! Sirf $20 mein ek trial zoom session try karo 💪 ${trialUrl}`]
        : [`Hey! Try a trial zoom session for just $20 💪 ${trialUrl}`];

      await sendWhatsApp(lead.phone, 'nudge_trial', params);
      results.nudged_2hr++;
    }

    // 2. Drop leads with no reply after 24 hours
    const twentyFourHoursAgo = new Date(now - TWENTY_FOUR_HOURS_MS).toISOString();
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of (deadLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count > 0) continue;

      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      results.dropped_24hr++;
    }

    // 3. Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
    const eightDaysAgo = new Date(now - SEVEN_DAYS_MS - TWENTY_FOUR_HOURS_MS).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    for (const lead of (droppedLeads || [])) {
      const reengageCount = await getTemplateCount(lead.phone, 'reengage_7day');
      if (reengageCount > 0) continue;

      const hinglish = isHinglish(lead.phone);
      const params = hinglish
        ? [lead.name || 'there', 'Abhi bhi fitness goals ke baare mein soch rahe ho? Maddy ka special offer check karo 💪']
        : [lead.name || 'there', 'Still thinking about your fitness goals? Check out Maddy\'s special offer 💪'];

      await sendWhatsApp(lead.phone, 'reengage_7day', params);
      results.reengaged_7day++;
    }

    return res.status(200).json({ message: 'Nudge cron complete', ...results });
  } catch (err) {
    console.error(`Nudge cron error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function getOutboundCount(phone, since) {
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gt('sent_at', since);
  return count || 0;
}

async function getTemplateCount(phone, template) {
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('template_name', template);
  return count || 0;
}
