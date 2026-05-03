const { getSupabase } = require('./lib/supabase');
const { needsEscalation, createEscalation } = require('./lib/escalate');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const db = getSupabase();

  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);

  if (!clientId || !weekNo) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const photosUrls = [];
  if (body.photos && Array.isArray(body.photos)) {
    for (const photo of body.photos) {
      if (photo.base64 && photo.filename) {
        const buf = Buffer.from(photo.base64, 'base64');
        const path = `clients/${clientId}/checkin_w${weekNo}_${photo.filename}`;
        await db.storage.from('client-files').upload(path, buf, {
          contentType: photo.contentType || 'image/jpeg'
        });
        const { data: urlData } = db.storage.from('client-files').getPublicUrl(path);
        if (urlData?.publicUrl) photosUrls.push(urlData.publicUrl);
      }
    }
  }

  const issues = body.issues || '';
  if (needsEscalation(issues)) {
    await createEscalation(client.phone, 'Health concern in check-in', issues);
  }

  const { data: checkin } = await db.from('checkins').insert({
    client_id: clientId,
    week_no: weekNo,
    weight: body.weight ? parseFloat(body.weight) : null,
    waist: body.waist ? parseFloat(body.waist) : null,
    compliance_score: body.compliance ? parseInt(body.compliance, 10) : null,
    energy: body.energy ? parseInt(body.energy, 10) : null,
    issues,
    photos_urls: photosUrls
  }).select().single();

  if (client.program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
    fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, checkin_id: checkin?.id });
};
