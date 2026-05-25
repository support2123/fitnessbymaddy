const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  // Parse multipart form data (Vercel handles this with body parsing)
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Expected multipart/form-data' });
  }

  // In Vercel serverless, we need to handle the raw body
  // For simplicity, we accept base64 encoded files via JSON as fallback
  const clientId = req.body?.client_id || 'unknown';
  const weekNo = req.body?.week_no || '0';

  if (!req.body?.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const fileName = `${clientId}/week_${weekNo}_${Date.now()}.jpg`;

  const { data, error } = await supabase.storage
    .from('checkin-photos')
    .upload(fileName, Buffer.from(req.body.file, 'base64'), {
      contentType: 'image/jpeg',
      upsert: false
    });

  if (error) return res.status(500).json({ error: 'Upload failed' });

  const { data: urlData } = supabase.storage
    .from('checkin-photos')
    .getPublicUrl(fileName);

  return res.status(200).json({ success: true, url: urlData.publicUrl });
};
