const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.headers['x-vercel-cron'] !== '1' &&
    !req.headers['x-forwarded-for']?.includes('127.0.0.1')
  ) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const fourteenDaysAgo = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, created_at')
      .eq('status', 'new')
      .lte('last_msg_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hoursOld =
          (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60);

        const { data: alreadyNudged } = await db
          .from('nudge_log')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('nudge_type', 'trial_nudge')
          .limit(1)
          .single();

        if (hoursOld >= 24) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        } else if (hoursOld >= 2 && !alreadyNudged) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            bodyValues: [
              lead.name || 'there',
              'https://fitnessbymaddy.com/program-trial.html',
            ],
          });

          await db.from('nudge_log').insert({
            lead_id: lead.id,
            nudge_type: 'trial_nudge',
          });

          nudged++;
        }
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: alreadyReEngaged } = await db
          .from('nudge_log')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('nudge_type', 're_engage')
          .limit(1)
          .single();

        if (!alreadyReEngaged) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'reengage_offer',
            bodyValues: [lead.name || 'there'],
          });

          await db.from('nudge_log').insert({
            lead_id: lead.id,
            nudge_type: 're_engage',
          });

          reEngaged++;
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({ ok: true, nudged, dropped, reEngaged })
    );
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
