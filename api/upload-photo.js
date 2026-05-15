const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

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
  if (!boundary) return res.status(400).json({ error: 'No boundary found' });

  const parts = parseMultipart(buffer, boundary);

  const filePart = parts.find((p) => p.filename);
  const clientId = parts.find((p) => p.name === 'client_id')?.value;
  const weekNo = parts.find((p) => p.name === 'week_no')?.value;

  if (!filePart || !clientId) {
    return res.status(400).json({ error: 'file and client_id required' });
  }

  const ext = filePart.filename.split('.').pop() || 'jpg';
  const fileName = `clients/${clientId}/photos/week_${weekNo || 'x'}_${Date.now()}.${ext}`;

  const { error } = await db.storage.from('programs').upload(fileName, filePart.data, {
    contentType: filePart.contentType || 'image/jpeg',
    upsert: true,
  });

  if (error) return res.status(500).json({ error: 'Upload failed' });

  const { data: urlData } = db.storage.from('programs').getPublicUrl(fileName);

  return res.status(200).json({ url: urlData?.publicUrl || fileName });
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  let start = buffer.indexOf(boundaryBuf) + boundaryBuf.length + 2;

  while (start < buffer.length) {
    const end = buffer.indexOf(boundaryBuf, start);
    if (end === -1) break;

    const partBuf = buffer.slice(start, end - 2);
    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = end + boundaryBuf.length + 2; continue; }

    const headers = partBuf.slice(0, headerEnd).toString();
    const data = partBuf.slice(headerEnd + 4);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);

    if (filenameMatch) {
      parts.push({ name: nameMatch?.[1], filename: filenameMatch[1], contentType: ctMatch?.[1]?.trim(), data });
    } else if (nameMatch) {
      parts.push({ name: nameMatch[1], value: data.toString().trim() });
    }

    start = end + boundaryBuf.length + 2;
  }
  return parts;
}
