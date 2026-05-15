const { getSupabase } = require('../_lib/supabase');
const { sendWithRateLimit } = require('../_lib/whatsapp');
const { maskPhone, jsonResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0 };

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', sevenDaysAgo.toISOString())
      .lte('last_msg_at', twoDaysAgo.toISOString());

    if (!newLeads || newLeads.length === 0) {
      return jsonResponse(res, 200, { ok: true, message: 'No leads to nudge', ...results });
    }

    for (const lead of newLeads) {
      const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 2 && hoursSinceLastMsg < 24) {
        const result = await sendWithRateLimit(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);

        if (result.ok) results.nudged++;
        else results.skipped++;
      } else if (hoursSinceLastMsg >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        results.skipped++;
        console.log(`[Nudge] Dropped: ${maskPhone(lead.phone)} (no reply 24h+)`);
      } else {
        results.skipped++;
      }
    }

    const { data: qualifiedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'qualified')
      .gte('created_at', sevenDaysAgo.toISOString())
      .lte('last_msg_at', twoDaysAgo.toISOString());

    if (qualifiedLeads) {
      for (const lead of qualifiedLeads) {
        const result = await sendWithRateLimit(lead.phone, 'nudge_qualified', [
          lead.name || 'there',
          lead.program_interest || 'your selected program'
        ]);

        if (result.ok) results.nudged++;
        else results.skipped++;
      }
    }

    return jsonResponse(res, 200, { ok: true, ...results });
  } catch (err) {
    console.error('[Nudge Cron Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
