const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSend } = require('../../lib/whatsapp');
const { verifyCron, maskPhone } = require('../../lib/utils');

const COOLDOWN_DAYS = 7;
const NUDGE_WINDOW_HOURS = 2;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // Find new leads with no reply after 2 hours
    const nudgeCutoff = new Date(now - NUDGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', nudgeCutoff);

    let nudged = 0;
    let dropped = 0;
    let reengaged = 0;

    // Nudge stale "new" leads
    for (const lead of staleNew || []) {
      const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

      if (hoursSinceMsg >= 24) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        console.log(`Dropped: ${maskPhone(lead.phone)} (24h no reply)`);
        continue;
      }

      const allowed = await canSend(lead.phone);
      if (!allowed) continue;

      const template = lead.market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en';
      await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/intake.html',
      ]);
      nudged++;
    }

    // Re-engage dropped leads (7-day cooling period)
    const reengageCutoff = new Date(now - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const reengageMax = new Date(now - (COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', reengageCutoff)
      .gt('last_msg_at', reengageMax);

    for (const lead of droppedLeads || []) {
      const allowed = await canSend(lead.phone);
      if (!allowed) continue;

      const template = lead.market === 'IN' ? 'reengage_hi' : 'reengage_en';
      await sendTemplate(lead.phone, template, [
        lead.name || 'there',
      ]);
      reengaged++;
      console.log(`Re-engaged: ${maskPhone(lead.phone)}`);
    }

    console.log(`Nudge cron: ${nudged} nudged, ${dropped} dropped, ${reengaged} re-engaged`);
    return res.status(200).json({ ok: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
