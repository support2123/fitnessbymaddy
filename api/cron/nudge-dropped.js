import { getSupabase } from '../_lib/supabase.js';
import { sendTemplate } from '../_lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of droppedLeads) {
      try {
        const { count } = await db.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_reengagement');

        if (count && count > 0) {
          results.skipped++;
          continue;
        }

        const market = lead.market || 'GLOBAL';
        const params = market === 'IN'
          ? ['Hey! Maddy ki team se ek aur baar. Abhi bhi interested ho fitness goals mein? $20 trial se shuru karo — zero risk.']
          : ['Hey! Quick follow-up from Maddy\'s team. Still thinking about your fitness goals? Start with a $20 trial — zero risk.'];

        await sendTemplate(lead.phone, 'nudge_reengagement', params);

        await db.from('messages').insert({
          phone: lead.phone,
          direction: 'out',
          body: params[0],
          template_name: 'nudge_reengagement',
          status: 'sent'
        });

        await db.from('leads').update({
          last_msg_at: new Date().toISOString()
        }).eq('id', lead.id);

        results.nudged++;
      } catch (leadErr) {
        console.error(`Nudge error for lead ${lead.id}:`, leadErr.message);
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
