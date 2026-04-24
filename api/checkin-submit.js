const { getSupabase, TABLES } = require('./_utils/supabase');
const { notifyMaddy, checkEscalationTriggers } = require('./_utils/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const contentType = req.headers['content-type'] || '';
    let body, photoUrls = [];

    if (contentType.includes('multipart/form-data')) {
      body = req.body || {};
      photoUrls = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const path = `checkins/${body.client_id}/week_${body.week_no}/${file.originalname}`;
          const { error } = await db.storage.from('client-files').upload(path, file.buffer, {
            contentType: file.mimetype,
            upsert: true,
          });
          if (!error) {
            const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
            photoUrls.push(urlData.publicUrl);
          }
        }
      }
    } else {
      body = req.body || {};
      photoUrls = body.photos_urls || [];
    }

    const { client_id, week_no, weight, waist, compliance_score, energy, issues } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from(TABLES.CLIENTS)
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await db
      .from(TABLES.CHECKINS)
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      await db.from(TABLES.CHECKINS).update({
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photoUrls,
        form_submitted_at: new Date().toISOString(),
      }).eq('id', existing[0].id);
    } else {
      await db.from(TABLES.CHECKINS).insert({
        client_id,
        week_no: parseInt(week_no),
        form_submitted_at: new Date().toISOString(),
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photoUrls,
        next_week_focus: null,
      });
    }

    if (issues) {
      const escalation = checkEscalationTriggers(issues);
      if (escalation) {
        await notifyMaddy(escalation, `Client: ${client.name} (${client.phone})\nWeek ${week_no}: ${issues.slice(0, 200)}`);
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Auto-generate trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
