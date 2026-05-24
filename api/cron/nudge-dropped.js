const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const db = getSupabase();
  let nudged = 0;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoDaysAgo)
      .gt('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ nudged: 0, message: 'No leads to nudge' });
    }

    for (const lead of newLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1)
        .single();

      if (recentMsg) continue;

      const trialUrl = 'https://www.fitnessbymaddy.com/shred.html';

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialUrl,
      ]);

      console.log(`Nudged: ${maskPhone(lead.phone)}`);
      nudged++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db.from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);

      console.log(`Dropped ${staleIds.length} stale leads`);
    }

    return res.status(200).json({ nudged, dropped: staleLeads?.length || 0 });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
