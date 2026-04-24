const { getSupabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const db = getSupabase();

  try {
    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Check-in health concern',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}`
      );
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      await db
        .from('checkins')
        .update({
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score ? parseInt(compliance_score) : null,
          energy: energy ? parseInt(energy) : null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      });
    }

    const market = detectMarket(client.phone);
    if (isHinglish(market)) {
      await sendText(
        client.phone,
        `Check-in received! 💪 Week ${week_no} ka data save ho gaya. ${client.program === '12wk' ? 'Next week ka plan jaldi aayega!' : 'Keep crushing it!'}`
      );
    } else {
      await sendText(
        client.phone,
        `Check-in received! 💪 Week ${week_no} data saved. ${client.program === '12wk' ? 'Your updated plan will be ready soon!' : 'Keep crushing it!'}`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
