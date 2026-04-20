import supabase from './_lib/supabase.js';
import { needsEscalation, escalateToMaddy } from './_lib/escalation.js';
import { maskPhone } from './_lib/mask.js';

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
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in check-in',
        client.phone,
        `Week ${week_no}: ${issues}`
      );
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: Math.min(10, Math.max(1, parseInt(compliance_score) || 5)),
      energy: Math.min(10, Math.max(1, parseInt(energy) || 5)),
      issues: issues || null,
      photos_urls: photos_urls || [],
      next_week_focus: null,
    };

    if (existing) {
      await supabase.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert(checkinData);
    }

    if (client.program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(err => console.error(`Program gen trigger failed: ${err.message}`));
    }

    return res.status(200).json({ success: true, message: 'Check-in recorded' });
  } catch (err) {
    console.error(`Checkin error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}
