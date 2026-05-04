const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const results = [];

    if (newLeads) {
      for (const lead of newLeads) {
        const limited = await checkRateLimit(lead.phone);
        if (!limited) {
          const template = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial_en';
          await sendTemplate(lead.phone, template, [lead.name || 'there']);
          results.push({ phone: lead.phone, action: 'nudge_sent' });
        }
      }
    }

    const { data: staleNew } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (staleNew) {
      for (const lead of staleNew) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.push({ phone: lead.phone, action: 'dropped_24h' });
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const limited = await checkRateLimit(lead.phone);
        if (!limited) {
          const template = isHinglish(lead.market) ? 'reengage_hi' : 'reengage_en';
          await sendTemplate(lead.phone, template, [lead.name || 'there']);
          results.push({ phone: lead.phone, action: 'reengage_sent' });
        }
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
