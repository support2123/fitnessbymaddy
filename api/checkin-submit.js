const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      await db.from('checkins').update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight || null,
        waist: waist || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || []
      });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Check-in health concern', {
        phone: maskPhone(client.phone),
        message: issues.substring(0, 200),
        clientName: client.name || 'Unknown client'
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id, week_no });
  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return res.status(500).json({ error: 'Failed to submit check-in' });
  }
};
