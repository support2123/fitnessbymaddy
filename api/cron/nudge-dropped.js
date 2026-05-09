import supabase from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { isHinglish, maskPhone } from '../../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads').select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', sevenDaysAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursSinceLastMsg = (Date.now() - new Date(lead.last_msg_at).getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceLastMsg >= 2) {
          const params = isHinglish(lead.market)
            ? ['Ek $20 ka trial session try karo — zoom pe Maddy ke saath! 💪\nhttps://www.fitnessbymaddy.com/shred.html']
            : ['Try a $20 trial session — live on Zoom with Maddy! 💪\nhttps://www.fitnessbymaddy.com/shred.html'];

          await sendWhatsApp(lead.phone, 'nudge_trial', params);
          nudged++;
        }
      }
    }

    const { data: droppedLeads } = await supabase
      .from('leads').select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const daysSinceCreated = (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceCreated >= 3 && daysSinceCreated < 4) {
          const { count } = await supabase
            .from('messages').select('id', { count: 'exact', head: true })
            .eq('phone', lead.phone)
            .eq('template_name', 'reengagement_3day');

          if ((count || 0) === 0) {
            await sendWhatsApp(lead.phone, 'reengagement_3day', [
              lead.name || 'there'
            ]);
            reEngaged++;
          }
        }
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}, re-engaged=${reEngaged}`);
    return res.json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
