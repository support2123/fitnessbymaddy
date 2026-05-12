const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf');
const { maskPhone } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'skip meals for days', 'water fast for a week'
];

function hasSafetyIssue(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  // Fetch client
  const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Fetch last 2 check-ins
  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Fetch previous program if exists
  const { data: prevProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .single();

  // Build prompt
  const checkinSummary = (recentCheckins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const prompt = `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current Week: ${week_no}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

${prevProgram ? `PREVIOUS WEEK PLAN:
Workout: ${JSON.stringify(prevProgram.workout_plan)}
Nutrition: ${JSON.stringify(prevProgram.nutrition_plan)}
Notes: ${prevProgram.notes || 'None'}` : 'This is the first week program.'}

Generate a detailed, progressive week ${week_no} program. Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ],
    "notes": "Progressive overload focus"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70,
    "meals": [
      { "name": "Breakfast", "time": "7:00 AM", "items": ["4 eggs", "2 toast", "1 banana"] }
    ],
    "notes": "Hydration: 3L water daily"
  },
  "coach_notes": "Brief note about this week's focus"
}

RULES:
- Never recommend extreme calorie cuts below 1200 for women or 1500 for men
- Never recommend banned or dangerous substances
- Set realistic, gradual progression goals
- Account for any issues/pain mentioned in check-ins
- If compliance was low, simplify rather than escalate`;

  let aiResponse;
  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    aiResponse = message.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  // Parse JSON from response
  let programData;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return res.status(500).json({ error: 'Failed to parse program data' });
  }

  // Safety check
  if (hasSafetyIssue(programData)) {
    await notifyMaddy(
      'Program Safety Flag — Manual Review Needed',
      `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nProgram flagged for potentially unsafe content. Please review before sending.`
    );
    // Still save but don't auto-send
    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: `[FLAGGED FOR REVIEW] ${programData.coach_notes || ''}`
    });
    return res.status(200).json({ success: true, flagged: true });
  }

  // Generate PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: programData.workout_plan,
      nutritionPlan: programData.nutrition_plan,
      notes: programData.coach_notes
    });
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  // Upload to Supabase Storage
  const pdfPath = `${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError.message);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  // Save to programs table
  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_notes,
    pdf_url: pdfUrl
  }).select().single();

  // Send via WhatsApp
  const contextNote = programData.coach_notes
    ? `Week ${week_no} is ready! ${programData.coach_notes}`
    : `Your Week ${week_no} program is ready! Check the PDF for full details. 💪`;

  await sendWhatsApp({
    phone: client.phone,
    body: `${contextNote}\n\nPDF: ${pdfUrl}`,
    isClient: true
  });

  // Update sent timestamp
  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
};
