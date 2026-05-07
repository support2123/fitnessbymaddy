const { getClient } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const parsedCompliance = Math.max(1, Math.min(10, parseInt(compliance_score) || 5));
    const parsedEnergy = Math.max(1, Math.min(10, parseInt(energy) || 5));

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: parsedCompliance,
      energy: parsedEnergy,
      issues: issues ? issues.substring(0, 2000) : null,
      photos_urls: Array.isArray(photos_urls) ? photos_urls : [],
    }).select().single();

    if (error) throw error;

    if (issues) {
      const lowerIssues = issues.toLowerCase();
      const alerts = ['pain', 'dizzy', 'faint', 'not eating', 'purging', 'injury'];
      for (const alert of alerts) {
        if (lowerIssues.includes(alert)) {
          await notifyMaddy(
            `Client health concern (week ${week_no})`,
            `${maskPhone(client.phone)}: ${issues.substring(0, 200)}`
          );
          break;
        }
      }
    }

    const { count: missedCount } = await db
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .is('weight', null);

    if (missedCount >= 2) {
      await notifyMaddy(
        '2+ missed check-ins',
        `Client ${maskPhone(client.phone)} has ${missedCount} incomplete check-ins`
      );
    }

    if (client.program === '12wk') {
      try {
        await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.log('Program generation triggered for:', maskPhone(client.phone));
      }
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'checkin_received',
      bodyValues: [
        client.name || 'there',
        `Week ${week_no} check-in received! Keep going strong.`,
      ],
    });

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
