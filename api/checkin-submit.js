const supabase = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

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

    const weekNum = parseInt(week_no);

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photoUrls = [];
    if (photos_urls && Array.isArray(photos_urls)) {
      for (const photoData of photos_urls.slice(0, 3)) {
        if (typeof photoData === 'string' && photoData.startsWith('data:')) {
          const matches = photoData.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1].split('/')[1] || 'jpg';
            const buffer = Buffer.from(matches[2], 'base64');
            const path = `clients/${client_id}/checkin_w${weekNum}_${Date.now()}.${ext}`;

            const { data: upload } = await supabase.storage
              .from('client-files')
              .upload(path, buffer, { contentType: matches[1] });

            if (upload) {
              const { data: urlData } = supabase.storage
                .from('client-files')
                .getPublicUrl(path);
              photoUrls.push(urlData.publicUrl);
            }
          }
        } else if (typeof photoData === 'string') {
          photoUrls.push(photoData);
        }
      }
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: weekNum,
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls
      })
      .select()
      .single();

    if (error) throw error;

    if (issues) {
      const lowerIssues = issues.toLowerCase();
      const concerning = ['pain', 'dizzy', 'faint', 'nausea', 'injury', 'hurt'];
      if (concerning.some(kw => lowerIssues.includes(kw))) {
        await notifyMaddy(
          'Client Health Concern',
          `Client: ${client.name || client.phone}\nWeek ${weekNum}\nIssue: ${issues.slice(0, 300)}`
        );
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: weekNum + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
