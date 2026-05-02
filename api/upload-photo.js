const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'multipart/form-data required' });
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

    const supabase = getSupabase();
    const ext = filePart.filename.split('.').pop() || 'jpg';
    const fileName = `clients/${clientId}/week_${weekNo}_${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('checkin-photos')
      .upload(fileName, filePart.data, {
        contentType: filePart.contentType || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Photo upload error:', error.message);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data: publicUrl } = supabase.storage
      .from('checkin-photos')
      .getPublicUrl(fileName);

    return res.status(200).json({ url: publicUrl?.publicUrl || null });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  const str = buffer.toString('binary');
  const sections = str.split('--' + boundary);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    if (section.startsWith('--')) break;

    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = section.substring(0, headerEnd);
    const body = section.substring(headerEnd + 4, section.length - 2);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);

    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
      data: filenameMatch ? Buffer.from(body, 'binary') : Buffer.from(body.trim()),
    });
  }

  return parts;
}
