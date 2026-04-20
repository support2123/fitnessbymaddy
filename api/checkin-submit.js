import { supabase } from '../lib/supabase.js';
import { maskPhone } from '../lib/mask.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
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
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight: weight || null,
          waist: waist || null,
          compliance_score: compliance_score || null,
          energy: energy || null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch((err) => {
        console.error('Program generation trigger failed:', err.message);
      });
    }

    console.log(`Check-in submitted: client ${client_id.slice(0, 8)}... week ${week_no}`);
    return res.status(200).json({ status: 'checkin_saved', client_id, week_no });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
