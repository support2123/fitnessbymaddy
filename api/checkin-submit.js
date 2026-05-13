const { getSupabase } = require('../lib/supabase');
const { shouldEscalate } = require('../lib/escalation');
const { escalateToMaddy } = require('../lib/escalation');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkin, error: insertErr } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        form_submitted_at: new Date().toISOString(),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (shouldEscalate(issues)) {
      await escalateToMaddy({
        reason: 'Health concern in weekly check-in',
        phone: client.phone,
        name: client.name,
        message: issues,
        context: `Week ${week_no} check-in`,
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'checkin_received',
      bodyValues: [client.name || 'there', String(week_no)],
    });

    return res.json({
      ok: true,
      checkin_id: checkin.id,
      message: 'Check-in saved successfully!',
    });

  } catch (err) {
    console.error('Checkin submit error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
