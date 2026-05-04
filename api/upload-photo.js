const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Multipart form data required' });
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'No boundary found' });
    }

    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find(p => p.filename);
    const clientId = parts.find(p => p.name === 'client_id')?.data?.toString() || 'unknown';
    const weekNo = parts.find(p => p.name === 'week_no')?.data?.toString() || '0';

    if (!filePart) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const db = getSupabase();
    const ext = filePart.filename.split('.').pop() || 'jpg';
    const path = `clients/${clientId}/week_${weekNo}_${Date.now()}.${ext}`;

    const { error } = await db.storage
      .from('programs')
      .upload(path, filePart.data, {
        contentType: filePart.contentType || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      return res.status(500).json({ error: 'Upload failed: ' + error.message });
    }

    const { data: urlData } = db.storage.from('programs').getPublicUrl(path);

    return res.status(200).json({ success: true, url: urlData.publicUrl });
  } catch (err) {
    console.error('Photo upload error:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  const str = buffer.toString('binary');
  const sections = str.split('--' + boundary);

  for (const section of sections) {
    if (section === '' || section === '--\r\n' || section.startsWith('--')) continue;

    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const header = section.substring(0, headerEnd);
    const body = section.substring(headerEnd + 4).replace(/\r\n$/, '');

    const nameMatch = header.match(/name="([^"]+)"/);
    const filenameMatch = header.match(/filename="([^"]+)"/);
    const ctMatch = header.match(/Content-Type:\s*(.+)/i);

    const part = {
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : null,
      data: Buffer.from(body, 'binary'),
    };

    parts.push(part);
  }

  return parts;
}
