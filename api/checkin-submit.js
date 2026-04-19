const { getSupabase } = require('./_lib/supabase');
const { handleOptions } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabase = getSupabase();
    var b = req.body;

    if (!b.client_id || !b.week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    var clientRes = await supabase.from('clients').select('*').eq('id', b.client_id).single();
    if (!clientRes.data) {
      return res.status(404).json({ error: 'Client not found' });
    }

    var client = clientRes.data;
    var weekNo = parseInt(b.week_no);
    var photoUrls = [];

    if (b.photos && Array.isArray(b.photos)) {
      for (var i = 0; i < b.photos.length && i < 5; i++) {
        var photo = b.photos[i];
        if (!photo.data || !photo.name) continue;

        var base64 = photo.data.replace(/^data:image\/\w+;base64,/, '');
        var buffer = Buffer.from(base64, 'base64');
        var ext = photo.name.split('.').pop() || 'jpg';
        var path = 'clients/' + client.id + '/checkin_w' + weekNo + '_' + (i + 1) + '.' + ext;

        var uploadRes = await supabase.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: 'image/' + ext,
            upsert: true
          });

        if (!uploadRes.error) {
          var urlRes = supabase.storage.from('clients').getPublicUrl(path);
          photoUrls.push(urlRes.data.publicUrl);
        }
      }
    }

    var checkinData = {
      client_id: b.client_id,
      week_no: weekNo,
      form_submitted_at: new Date().toISOString(),
      weight: b.weight ? parseFloat(b.weight) : null,
      waist: b.waist ? parseFloat(b.waist) : null,
      compliance_score: b.compliance_score ? parseInt(b.compliance_score) : null,
      energy: b.energy ? parseInt(b.energy) : null,
      issues: b.issues || null,
      photos_urls: photoUrls,
      next_week_focus: b.next_week_focus || null
    };

    var upsertRes = await supabase.from('checkins').upsert(checkinData, {
      onConflict: 'client_id,week_no'
    });

    if (upsertRes.error) {
      console.error('Checkin upsert error:', upsertRes.error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        var origin = 'https://' + (req.headers.host || 'fitnessbymaddy.com');
        await fetch(origin + '/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: weekNo + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'ok', message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
