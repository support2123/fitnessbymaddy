const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Must be multipart/form-data' });
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary found' });

    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find(p => p.filename);
    const clientId = parts.find(p => p.name === 'client_id')?.value;
    const weekNo = parts.find(p => p.name === 'week_no')?.value;

    if (!filePart || !clientId || !weekNo) {
      return res.status(400).json({ error: 'file, client_id, and week_no required' });
    }

    const ext = filePart.filename.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const path = `clients/${clientId}/photos/week_${weekNo}_${timestamp}.${ext}`;

    const db = getSupabase();
    const { error } = await db.storage.from('programs').upload(path, filePart.data, {
      contentType: filePart.contentType || 'image/jpeg',
      upsert: false
    });

    if (error) throw error;

    const { data: { publicUrl } } = db.storage.from('programs').getPublicUrl(path);

    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const str = buffer.toString('binary');
  const sections = str.split(`--${boundary}`).slice(1, -1);

  for (const section of sections) {
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = section.slice(0, headerEnd);
    const body = section.slice(headerEnd + 4).replace(/\r\n$/, '');

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);

    if (filenameMatch) {
      parts.push({
        name: nameMatch ? nameMatch[1] : null,
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
        data: Buffer.from(body, 'binary')
      });
    } else if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        value: body.trim()
      });
    }
  }
  return parts;
}
