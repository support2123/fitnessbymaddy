const { supabase } = require('./_lib/supabase');
const { sendWhatsAppWithRateLimit } = require('./_lib/whatsapp');
const { cors, parseBody, needsEscalation, maskPhone } = require('./_lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, height,
    } = body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeNote = [
      injuries, medical_conditions, goal,
    ].filter(Boolean).join(' ');

    if (needsEscalation(intakeNote)) {
      await sendWhatsAppWithRateLimit(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(lead.phone), `Intake form flag: ${intakeNote.slice(0, 150)}`],
        'Maddy',
        true
      );
    }

    const metadata = {
      email, age, gender, goal, injuries, diet_pref,
      schedule, experience, medical_conditions,
      current_weight, height,
    };

    const { error } = await supabase.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(metadata),
    }).eq('id', lead_id);

    if (error) throw error;

    await sendWhatsAppWithRateLimit(
      lead.phone,
      'intake_received',
      [name || lead.name || 'there'],
      name || lead.name || 'there',
      false
    );

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
