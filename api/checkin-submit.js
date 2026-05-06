const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, token
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    let photos_urls = [];
    if (req.body.photos && Array.isArray(req.body.photos)) {
      for (const photo of req.body.photos) {
        const fileName = `clients/${client_id}/checkin_w${week_no}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const buffer = Buffer.from(photo.data, 'base64');
        const { error: uploadErr } = await supabase.storage
          .from('client-files')
          .upload(fileName, buffer, { contentType: 'image/jpeg' });

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('client-files')
            .getPublicUrl(fileName);
          photos_urls.push(urlData.publicUrl);
        }
      }
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        form_submitted_at: new Date().toISOString(),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls
      })
      .select()
      .single();

    if (error) throw error;

    if (client.program === '12wk') {
      await fetch(`${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
