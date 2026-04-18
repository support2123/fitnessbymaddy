const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_pref,
      schedule, experience, medical_conditions, photos,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join('; ');
    const esc = needsEscalation(medicalText);
    if (esc.escalate) {
      await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
        maskPhone(lead.phone),
        `Intake form — ${esc.keywords.join(', ')}`,
        medicalText.slice(0, 200),
      ]);
    }

    // Store intake data as a note on the lead (extend later with dedicated table if needed)
    const intakeData = { age, goal, injuries, diet_pref, schedule, experience, medical_conditions };
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
    });

    // Upload photos if provided
    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (photoData) {
          const buffer = Buffer.from(photoData.split(',')[1] || photoData, 'base64');
          await supabase.storage.from('clients')
            .upload(`intake/${lead_id}/photo_${i}.jpg`, buffer, {
              contentType: 'image/jpeg', upsert: true,
            });
        }
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
