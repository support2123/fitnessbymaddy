const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  try {
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

    let uploadedUrls = [];
    if (photos_urls && Array.isArray(photos_urls)) {
      uploadedUrls = photos_urls;
    }

    const { error: insertErr } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: uploadedUrls
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'Check-in already submitted for this week' });
      }
      throw insertErr;
    }

    if (issues && issues.length > 10) {
      const lowerIssues = issues.toLowerCase();
      const redFlags = ['pain', 'dizzy', 'faint', 'vomit', 'can\'t eat', 'not eating'];
      if (redFlags.some(f => lowerIssues.includes(f))) {
        await notifyMaddy(
          'Client health concern',
          `${maskPhone(client.phone)} Week ${week_no}: ${issues.slice(0, 150)}`
        );
      }
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';
      const protocol = baseUrl.includes('localhost') ? 'http' : 'https';
      await fetch(`${protocol}://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      });
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there', String(week_no)
    ]);

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
