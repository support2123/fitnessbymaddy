import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('checkin_health_concern', client.phone, issues);
    }

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    await sendWhatsApp(
      client.phone,
      `Check-in for Week ${week_no} received! Your updated program will be sent soon.`,
      null,
      true
    );

    if (client.program === '12wk') {
      const genUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      }).catch((err) => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
