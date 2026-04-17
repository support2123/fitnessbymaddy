const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { needsEscalation, MADDY_PHONE, maskPhone } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

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

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      await supabase.from('checkins').update({
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || []
      });
    }

    if (issues && needsEscalation(issues)) {
      await sendWhatsApp({
        phone: MADDY_PHONE,
        templateName: 'escalation_alert',
        params: [maskPhone(client.phone), 'Check-in concern', issues.substring(0, 200)],
        body: `ESCALATION — Check-in concern\nClient: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: "${issues.substring(0, 200)}"`
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to submit check-in' });
  }
};
