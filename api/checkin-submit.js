import supabase from '../lib/supabase.js';
import { checkEscalation } from '../lib/escalation.js';
import { notifyMaddy } from '../lib/whatsapp.js';
import { maskPhone } from '../lib/market.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const escalation = checkEscalation(issues);
  if (escalation) {
    await notifyMaddy(
      'Client check-in concern',
      `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nTriggers: ${escalation.join(', ')}\nIssues: ${issues?.slice(0, 300)}`
    );
  }

  const { error } = await supabase.from('checkins').upsert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues?.slice(0, 2000),
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString(),
  }, { onConflict: 'client_id,week_no' });

  if (error) {
    console.error('Checkin save error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_API_KEY,
      },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
    }).catch(err => console.error('Program gen trigger error:', err.message));
  }

  return res.status(200).json({ ok: true, message: 'Check-in submitted' });
}
