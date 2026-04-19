import { getSupabase } from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { maskPhone } from '../../lib/mask-phone.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo.toISOString())
      .gte('last_msg_at', fourteenDaysAgo.toISOString());

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of reEngageLeads) {
      const trialUrl = 'https://fitnessbymaddy.com/intake.html?program=zoom_trial';

      const result = await sendTemplate(lead.phone, 'nudge_reengage', [
        lead.name || 'there',
        trialUrl,
      ]);

      if (!result.rateLimited) {
        nudged++;
        console.log(`Re-engage nudge: ${maskPhone(lead.phone)}`);
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', fourteenDaysAgo.toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map((l) => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
      console.log(`Marked ${staleIds.length} stale leads as dropped`);
    }

    return res.status(200).json({ success: true, nudged, staleDropped: staleLeads?.length || 0 });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
