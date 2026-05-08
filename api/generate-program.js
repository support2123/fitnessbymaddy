const { getSupabase } = require('../lib/supabase');
const { generateWeeklyProgram } = require('../lib/program-generator');
const { sendDocument, notifyMaddy } = require('../lib/whatsapp');
const { parseBody, handleCors, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { client_id } = body;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }

  const db = getSupabase();

  // Fetch client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (client.status !== 'active') {
    return res.status(400).json({ error: 'Client not active' });
  }

  // Fetch last 2 check-ins
  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: true });

  // Generate program via Claude
  const result = await generateWeeklyProgram(client, checkins || []);

  if (!result.success) {
    if (result.flagged) {
      // Safety flag — halt and notify Maddy
      await notifyMaddy(
        `Program generation safety flag: ${result.reason}`,
        client.phone,
        `Client: ${client.name}, Week: ${result.week_no || '?'}`
      );

      await db.from('programs').insert({
        client_id,
        week_no: result.week_no || 0,
        flagged_for_review: true,
        notes: result.reason
      });

      return res.status(200).json({ success: false, flagged: true, reason: result.reason });
    }

    return res.status(500).json({ error: result.reason });
  }

  // Store program in database (audit trail — REQUIRED before sending)
  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no: result.week_no,
    workout_plan: result.workout_plan,
    nutrition_plan: result.nutrition_plan,
    notes: result.coach_note
  }).select().single();

  // Generate a simple text-based program summary (PDF generation would require
  // a separate service like Puppeteer/wkhtmltopdf — for now we store the data
  // and send a text summary via WhatsApp)
  const programSummary = buildProgramSummary(result, client.name, result.week_no);

  // Upload program JSON to Supabase Storage as a reference
  const storagePath = `clients/${client_id}/week_${result.week_no}.json`;
  await db.storage
    .from('programs')
    .upload(storagePath, JSON.stringify({
      workout_plan: result.workout_plan,
      nutrition_plan: result.nutrition_plan,
      coach_note: result.coach_note,
      generated_at: new Date().toISOString()
    }), { contentType: 'application/json', upsert: true });

  // Get public URL
  const { data: urlData } = db.storage
    .from('programs')
    .getPublicUrl(storagePath);

  const pdfUrl = urlData?.publicUrl || null;

  // Update program record with URL
  await db.from('programs').update({
    pdf_url: pdfUrl
  }).eq('id', program.id);

  // Send via WhatsApp
  const { sendTemplate } = require('../lib/whatsapp');
  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${result.week_no}`,
    result.coach_note.slice(0, 200)
  ]);

  // Mark as sent
  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('id', program.id);

  console.log(`Program generated: ${maskPhone(client.phone)} Week ${result.week_no}`);
  return res.status(200).json({
    success: true,
    program_id: program.id,
    week_no: result.week_no
  });
};

function buildProgramSummary(result, name, weekNo) {
  let summary = `📋 Week ${weekNo} Program for ${name || 'you'}\n\n`;
  summary += `💬 ${result.coach_note}\n\n`;

  if (result.nutrition_plan) {
    const np = result.nutrition_plan;
    summary += `🥗 NUTRITION:\n`;
    if (np.calories) summary += `• Calories: ${np.calories}\n`;
    if (np.protein) summary += `• Protein: ${np.protein}g\n`;
    if (np.carbs) summary += `• Carbs: ${np.carbs}g\n`;
    if (np.fats) summary += `• Fats: ${np.fats}g\n`;
    summary += '\n';
  }

  summary += `💪 Full workout plan has been uploaded. Check your check-in form for details.`;
  return summary;
}
