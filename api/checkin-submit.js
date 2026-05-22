import { getSupabase } from './_lib/supabase.js';
import { checkEscalation, escalateToMaddy } from './_lib/escalation.js';
import { handleCors, parseBody } from './_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const data = parseBody(req);

  const clientId = data.client_id;
  const weekNo = parseInt(data.week_no, 10);

  if (!clientId || !weekNo) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (checkEscalation(data.issues)) {
    await escalateToMaddy('Check-in health concern', client.phone, data.issues);
  }

  let photoUrls = [];
  if (data.photos && Array.isArray(data.photos)) {
    for (const photo of data.photos) {
      if (photo.startsWith('data:')) {
        const base64 = photo.split(',')[1];
        const ext = photo.includes('png') ? 'png' : 'jpg';
        const fileName = `clients/${clientId}/week_${weekNo}_${Date.now()}.${ext}`;
        const buffer = Buffer.from(base64, 'base64');

        const { data: uploaded } = await db.storage
          .from('client-files')
          .upload(fileName, buffer, { contentType: `image/${ext}` });

        if (uploaded) {
          const { data: urlData } = db.storage
            .from('client-files')
            .getPublicUrl(fileName);
          photoUrls.push(urlData.publicUrl);
        }
      } else {
        photoUrls.push(photo);
      }
    }
  }

  const { error } = await db.from('checkins').insert({
    client_id: clientId,
    week_no: weekNo,
    weight: data.weight || null,
    waist: data.waist || null,
    compliance_score: data.compliance_score || null,
    energy: data.energy || null,
    issues: data.issues || null,
    photos_urls: photoUrls,
    next_week_focus: data.next_week_focus || null
  });

  if (error) return res.status(500).json({ error: 'Failed to save check-in' });

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
      });
    } catch (err) {
      console.error('Failed to trigger program generation:', err.message);
    }
  }

  return res.json({ ok: true, message: 'Check-in submitted' });
}
