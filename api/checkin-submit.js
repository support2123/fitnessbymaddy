const { getClient } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body;
    var client_id = body.client_id;
    var week_no = body.week_no;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    var db = getClient();

    var clientResult = await db.from('clients').select('*')
      .eq('id', client_id).eq('status', 'active').single();

    if (!clientResult.data) {
      return res.status(404).json({ error: 'Client not found or inactive' });
    }

    var client = clientResult.data;

    // Handle photo uploads via base64
    var photos_urls = [];
    if (body.photos && Array.isArray(body.photos)) {
      for (var i = 0; i < body.photos.length; i++) {
        var photo = body.photos[i];
        if (photo.startsWith('data:')) {
          var base64 = photo.split(',')[1];
          var buffer = Buffer.from(base64, 'base64');
          var fileName = 'clients/' + client_id + '/checkin_w' + week_no + '_' + Date.now() + '_' + i + '.jpg';
          var uploadResult = await db.storage
            .from('client-files')
            .upload(fileName, buffer, { contentType: 'image/jpeg' });
          if (uploadResult.data) {
            var urlData = db.storage.from('client-files').getPublicUrl(fileName);
            photos_urls.push(urlData.data.publicUrl);
          }
        } else if (photo.startsWith('http')) {
          photos_urls.push(photo);
        }
      }
    }

    var { error } = await db.from('checkins').insert({
      client_id: client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: body.weight ? parseFloat(body.weight) : null,
      waist: body.waist ? parseFloat(body.waist) : null,
      compliance_score: body.compliance_score ? parseInt(body.compliance_score) : null,
      energy: body.energy ? parseInt(body.energy) : null,
      issues: body.issues || null,
      photos_urls: photos_urls
    });

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      var baseUrl = process.env.VERCEL_URL
        ? 'https://' + process.env.VERCEL_URL
        : 'https://fitnessbymaddy.com';
      fetch(baseUrl + '/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client_id, week_no: parseInt(week_no) + 1 })
      }).catch(function () {});
    }

    var confirmMsg = client.program === '12wk'
      ? 'Week ' + week_no + ' check-in received! Your updated program will be sent shortly.'
      : 'Week ' + week_no + ' check-in received! Keep crushing it!';
    await sendText(client.phone, '\u2705 ' + confirmMsg, true);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Checkin error for ' + maskPhone(req.body.client_id || '') + ':', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
