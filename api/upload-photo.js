const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const path = req.query.path;
    if (!path) return res.status(400).json({ error: 'Missing path' });

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const { error } = await supabase.storage
      .from('coaching')
      .upload(path, buffer, {
        contentType: req.headers['content-type'] || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Photo upload error:', error.message);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data } = supabase.storage
      .from('coaching')
      .getPublicUrl(path);

    return res.json({ url: data.publicUrl });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
