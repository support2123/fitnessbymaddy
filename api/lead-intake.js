const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const REQUIRED_FIELDS = ['name', 'email', 'phone'];

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_preference,
      workout_schedule,
      current_fitness_level,
      medical_conditions,
      photos,
    } = req.body || {};

    // ── Validate required fields ───────────────────────────────────
    const missing = REQUIRED_FIELDS.filter((f) => !req.body[f]);
    if (missing.length) {
      return res
        .status(400)
        .json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
    }

    const masked = maskPhone(phone);

    // ── Build metadata object ──────────────────────────────────────
    const metadata = {};
    if (age != null) metadata.age = age;
    if (goal) metadata.goal = goal;
    if (injuries) metadata.injuries = injuries;
    if (diet_preference) metadata.diet_preference = diet_preference;
    if (workout_schedule) metadata.workout_schedule = workout_schedule;
    if (current_fitness_level) metadata.current_fitness_level = current_fitness_level;
    if (medical_conditions) metadata.medical_conditions = medical_conditions;
    if (photos) metadata.photos = photos;

    // ── Upsert into leads table ────────────────────────────────────
    const now = new Date().toISOString();

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      const { error: updateErr } = await supabase
        .from('leads')
        .update({
          name,
          email,
          metadata,
          intake_completed_at: now,
          updated_at: now,
        })
        .eq('id', existingLead.id);

      if (updateErr) {
        console.error(`Lead update failed for ${masked}:`, updateErr.message);
        return res.status(500).json({ success: false, error: 'Database update failed' });
      }
    } else {
      const { error: insertErr } = await supabase.from('leads').insert({
        phone,
        name,
        email,
        status: 'new',
        metadata,
        source: 'intake_form',
        intake_completed_at: now,
        created_at: now,
        updated_at: now,
      });

      if (insertErr) {
        console.error(`Lead insert failed for ${masked}:`, insertErr.message);
        return res.status(500).json({ success: false, error: 'Database insert failed' });
      }
    }

    // ── If the lead also has a client record, update it ─────────────
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name,
          email,
          metadata,
          updated_at: now,
        })
        .eq('id', existingClient.id);
    }

    // ── Send confirmation WhatsApp ─────────────────────────────────
    await sendTemplate(phone, 'intake_received', {
      userName: name,
      templateParams: [name],
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
