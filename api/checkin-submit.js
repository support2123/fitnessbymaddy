const { supabase } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase.from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id, week_no, weight, waist,
        compliance_score, energy, issues,
        photos_urls: photos_urls || [],
      });
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(supabase, sendWhatsApp,
        'Client check-in flagged',
        `Client: ${maskPhone(client.phone)} (Week ${week_no})\nIssues: ${issues.slice(0, 200)}`
      );
    }

    const { data: missedCount } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: week_no + 1 }),
        });
      } catch (err) {
        console.error('Failed to trigger program generation:', err.message);
      }
    }

    await sendWhatsApp(client.phone,
      `Check-in received for Week ${week_no}! 💪 Your coach will review and your updated program will be sent soon.`,
      'checkin_confirmation'
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
