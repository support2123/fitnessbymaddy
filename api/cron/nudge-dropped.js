const { getClient } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'POST' || req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getClient();
    const now = new Date();

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const hinglish = isHinglish(lead.market);
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: [
            lead.name || 'there',
            hinglish
              ? 'Ek baar try toh karo! Sirf $20 mein ek live Zoom session with Maddy. No commitment.'
              : 'Give it a try! Just $20 for a live Zoom session with Maddy. No commitment.',
            'https://www.fitnessbymaddy.com/program-trial',
          ],
        });
        nudged++;
      }
    }

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const hinglish = isHinglish(lead.market);
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_v1',
          bodyValues: [
            lead.name || 'there',
            hinglish
              ? 'Abhi bhi interested ho fitness mein? Maddy ke programs mein limited spots hain.'
              : 'Still interested in your fitness goals? Limited spots available in Maddy\'s programs.',
          ],
        });
        reengaged++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (checkin) continue;

        const daysSinceSunday = (now.getDay() + 7) % 7;
        if (daysSinceSunday === 1 || daysSinceSunday === 2) {
          await sendWhatsApp({
            phone: client.phone,
            templateName: 'checkin_reminder',
            bodyValues: [
              client.name || 'there',
              `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`,
            ],
          });
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil((Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1) / 7);
}
