import supabase from '../lib/supabase.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      next_week_focus,
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
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const sanitizedIssues = issues ? issues.replace(/<[^>]*>/g, '').slice(0, 2000) : null;

    if (sanitizedIssues && needsEscalation(sanitizedIssues)) {
      await escalateToMaddy(client.phone, 'checkin_concern', sanitizedIssues);
    }

    const { error: insertErr } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? Math.min(10, Math.max(1, parseInt(compliance_score))) : null,
      energy: energy ? Math.min(10, Math.max(1, parseInt(energy))) : null,
      issues: sanitizedIssues,
      photos_urls: Array.isArray(photos_urls) ? photos_urls.slice(0, 5) : [],
      next_week_focus: next_week_focus ? next_week_focus.slice(0, 500) : null,
    });

    if (insertErr) {
      console.error('Checkin insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in received!' });
  } catch (err) {
    console.error('Checkin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
