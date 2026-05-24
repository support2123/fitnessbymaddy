const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, filename } = req.body;
    if (!client_id || !filename) {
      return res.status(400).json({ error: 'client_id and filename required' });
    }

    const ext = filename.split('.').pop().toLowerCase();
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
    if (!allowed.includes(ext)) {
      return res.status(400).json({ error: 'Only image files allowed (jpg, png, webp, heic)' });
    }

    const ts = Date.now();
    const path = `clients/${client_id}/checkin_w${week_no || 0}_${ts}.${ext}`;

    const { data, error } = await supabase.storage
      .from('client-files')
      .createSignedUploadUrl(path);

    if (error) {
      console.error('Signed URL error:', error.message);
      return res.status(500).json({ error: 'Failed to generate upload URL' });
    }

    const { data: publicUrl } = supabase.storage
      .from('client-files')
      .getPublicUrl(path);

    return res.status(200).json({
      upload_url: data.signedUrl,
      token: data.token,
      path,
      public_url: publicUrl?.publicUrl
    });
  } catch (err) {
    console.error('Upload URL error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
