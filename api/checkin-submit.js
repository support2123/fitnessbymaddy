const supabase = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglishMarket } = require('./_lib/market');
const { checkEscalation, escalate, checkConsecutiveMissedCheckins } = require('./_lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, token, weight, waist, compliance_score, energy, issues, photos } = req.body;

    if (!client_id || !week_no || !token) {
      return res.status(400).json({ error: 'client_id, week_no, and token are required' });
    }

    const expectedToken = generateToken(client_id, week_no);
    if (token !== expectedToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < Math.min(photos.length, 3); i++) {
        const photoData = photos[i];
        if (!photoData) continue;
        const buffer = Buffer.from(photoData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const fileName = `clients/${client_id}/checkin_w${week_no}_${i + 1}.jpg`;
        await supabase.storage.from('clients').upload(fileName, buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });
        const { data: urlData } = supabase.storage.from('clients').getPublicUrl(fileName);
        photoUrls.push(urlData.publicUrl);
      }
    }

    if (issues) {
      const escalationKeyword = checkEscalation(issues);
      if (escalationKeyword) {
        await escalate(client.phone, `Check-in issue: ${escalationKeyword}`, issues);
      }
    }

    await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls
    });

    const market = client.leads?.market || 'GLOBAL';
    const confirmMsg = isHinglishMarket(market)
      ? `Week ${week_no} check-in received! Great job staying consistent. Tumhara updated plan jaldi aayega.`
      : `Week ${week_no} check-in received! Great job staying consistent. Your updated plan is coming soon.`;

    await sendWhatsApp(client.phone, confirmMsg, null, true);

    if (client.program === '12wk') {
      const nextWeek = parseInt(week_no) + 1;
      if (nextWeek <= 12) {
        try {
          const baseUrl = getBaseUrl(req);
          await fetch(`${baseUrl}/api/generate-program`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
            },
            body: JSON.stringify({ client_id, week_no: nextWeek })
          });
        } catch (e) {
          console.error('Program generation trigger failed:', e.message);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generateToken(clientId, weekNo) {
  const secret = process.env.CHECKIN_TOKEN_SECRET || process.env.SUPABASE_SERVICE_KEY;
  return crypto.createHmac('sha256', secret).update(`${clientId}:${weekNo}`).digest('hex').slice(0, 16);
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports.generateToken = generateToken;
