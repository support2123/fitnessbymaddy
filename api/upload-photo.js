import { supabase } from '../lib/supabase.js';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ error: 'Missing boundary' });
    }

    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find((p) => p.name === 'file');
    const pathPart = parts.find((p) => p.name === 'path');

    if (!filePart || !pathPart) {
      return res.status(400).json({ error: 'Missing file or path' });
    }

    const filePath = pathPart.data.toString('utf8').trim();

    if (!filePath.startsWith('clients/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const { error } = await supabase.storage
      .from('client-files')
      .upload(filePath, filePart.data, {
        contentType: filePart.contentType || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Upload failed:', error.message);
      return res.status(500).json({ error: 'Upload failed' });
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    return res.status(200).json({ url: urlData?.publicUrl || filePath });
  } catch (err) {
    console.error('Photo upload error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBuf = Buffer.from(`--${boundary}--`);

  let start = bufferIndexOf(buffer, boundaryBuf, 0);
  if (start === -1) return parts;

  while (true) {
    start += boundaryBuf.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    start += 2; // skip \r\n

    const headerEnd = bufferIndexOf(buffer, Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;

    const headers = buffer.slice(start, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = bufferIndexOf(buffer, boundaryBuf, dataStart);
    if (nextBoundary === -1) break;

    const data = buffer.slice(dataStart, nextBoundary - 2); // -2 for \r\n before boundary

    const nameMatch = headers.match(/name="([^"]+)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);

    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
      data,
    });

    start = nextBoundary;
  }

  return parts;
}

function bufferIndexOf(buf, search, offset) {
  for (let i = offset; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}
