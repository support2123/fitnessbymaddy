import supabase from '../lib/supabase.js';
import { notifyMaddy } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photosUrls = [];
    if (req.body.photos_urls) {
      photosUrls = Array.isArray(req.body.photos_urls)
        ? req.body.photos_urls
        : [req.body.photos_urls];
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photosUrls,
        form_submitted_at: new Date().toISOString()
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (error) throw error;

    if (issues && (
      issues.toLowerCase().includes('pain') ||
      issues.toLowerCase().includes('dizz') ||
      issues.toLowerCase().includes('not eating')
    )) {
      await notifyMaddy(
        'Client health concern in check-in',
        `Client: ${client.name} (${client.phone.slice(0, 3)}XXX...${client.phone.slice(-3)})\nWeek ${week_no}\nIssues: ${issues}`
      );
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted successfully',
      checkin_id: checkin.id
    });

  } catch (err) {
    console.error('Checkin error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
