const { getSupabase } = require('../_utils/supabase');
const { sendTemplate, isRateLimited } = require('../_utils/whatsapp');
const { isHinglish, maskPhone } = require('../_utils/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = req.headers['x-vercel-cron'];
  if (!cronSecret && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', sevenDaysAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        try {
          const limited = await isRateLimited(lead.phone);
          if (limited) {
            results.skipped++;
            continue;
          }

          const hinglish = isHinglish(lead.market);

          if (hinglish) {
            await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          } else {
            await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
          }

          results.nudged++;
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    const { data: qualifiedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo)
      .gte('last_msg_at', sevenDaysAgo);

    if (qualifiedLeads) {
      for (const lead of qualifiedLeads) {
        try {
          const limited = await isRateLimited(lead.phone);
          if (limited) {
            results.skipped++;
            continue;
          }

          await sendTemplate(lead.phone, 'nudge_qualified', [lead.name || 'there']);
          results.nudged++;
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors++;
        }
      }
    }

    const dropCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('created_at', dropCutoff);

    return res.json({ success: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
