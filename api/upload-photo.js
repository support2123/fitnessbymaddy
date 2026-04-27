const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, photo_data, photo_name } = req.body;

    if (!client_id || !photo_data || !photo_name) {
      return res.status(400).json({ error: 'client_id, photo_data, and photo_name required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const base64Data = photo_data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const ext = photo_name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const filePath = `clients/${client_id}/checkin_w${week_no || 0}_${timestamp}.${ext}`;

    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(filePath, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: false
      });

    if (uploadError) {
      console.error('Photo upload error:', uploadError);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data: urlData } = await db.storage
      .from('client-files')
      .createSignedUrl(filePath, 90 * 86400);

    return res.status(200).json({
      ok: true,
      url: urlData?.signedUrl || filePath,
      path: filePath
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
