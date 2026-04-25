const { supabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/helpers');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

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
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    // Upload photos if provided as base64
    let photoUrls = photos_urls || [];
    if (req.body.photos_base64 && Array.isArray(req.body.photos_base64)) {
      photoUrls = [];
      for (let i = 0; i < req.body.photos_base64.length && i < 3; i++) {
        const base64 = req.body.photos_base64[i];
        const buffer = Buffer.from(base64, 'base64');
        const path = `${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
        await supabase.storage.from('clients').upload(path, buffer, {
          contentType: 'image/jpeg', upsert: true
        });
        const { data: urlData } = supabase.storage.from('clients').getPublicUrl(path);
        photoUrls.push(urlData.publicUrl);
      }
    }

    const { data: checkin } = await supabase.from('checkins').insert({
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
      photos_urls: photoUrls
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: 'check-in issue flag',
        message_body: issues
      });
      await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
        maskPhone(client.phone), 'check-in concern: ' + issues.slice(0, 100)
      ]);
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const generateUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`
        },
        body: JSON.stringify({ client_id, week_no: week_no + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
