const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendMediaMessage, notifyMaddy } = require('./_lib/whatsapp');
const { programLabel, maskPhone, jsonResponse, errorResponse } = require('./_lib/helpers');

const SAFETY_PATTERNS = [
  /\b(dnp|clenbuterol|anavar|winstrol|steroid|sarm|hgh)\b/i,
  /\b(under\s*800\s*cal|500\s*calorie|extreme\s*cut|starvation)\b/i,
  /\b(guaranteed|100%|miracle|no\s*exercise\s*needed)\b/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();
  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) {
    return errorResponse(res, 'client_id and week_no required');
  }

  // Fetch client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return errorResponse(res, 'Client not found', 404);

  // Fetch last 2 check-ins
  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Build context for Claude
  const clientContext = {
    name: client.name,
    program: programLabel(client.program),
    age: client.age,
    goal: client.goal,
    injuries: client.injuries,
    dietPref: client.diet_pref,
    schedule: client.schedule,
    weekNo: week_no
  };

  let checkinContext = 'No previous check-ins available.';
  if (checkins && checkins.length > 0) {
    checkinContext = checkins.map(c => (
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
      `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10` +
      (c.issues ? `, Issues: ${c.issues}` : '') +
      (c.next_week_focus ? `, Focus: ${c.next_week_focus}` : '')
    )).join('\n');
  }

  const systemPrompt = `You are a NASM-certified fitness program architect for Fitness by Maddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Be evidence-based and realistic
- Never recommend banned substances or extreme calorie deficits (<1200 kcal for women, <1500 for men)
- Account for injuries and limitations
- Progressive overload principle
- Adjust based on compliance and energy from check-ins
- If diet preference is mentioned, respect it strictly

OUTPUT FORMAT: Return valid JSON only, no markdown, no explanation. Schema:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "notes": "optional"
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"] }
    ],
    "notes": "optional"
  },
  "coach_notes": "Brief personalized note for the client"
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
${JSON.stringify(clientContext, null, 2)}

Recent Check-in Data:
${checkinContext}

Create a complete weekly workout plan (${client.schedule || '5 days'}) and nutrition plan.
${client.injuries ? `IMPORTANT: Client has injuries/limitations: ${client.injuries}. Modify exercises accordingly.` : ''}
${client.diet_pref ? `Diet preference: ${client.diet_pref}` : ''}`;

  let programData;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const raw = response.content[0].text;

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Program] Claude API error:', err.message);
    return errorResponse(res, 'Program generation failed', 500);
  }

  // Safety check
  const fullText = JSON.stringify(programData).toLowerCase();
  let flagged = false;
  let flaggedReason = '';

  for (const pattern of SAFETY_PATTERNS) {
    if (pattern.test(fullText)) {
      flagged = true;
      flaggedReason = `Safety pattern match: ${pattern.source}`;
      break;
    }
  }

  if (programData.nutrition?.calories && programData.nutrition.calories < 1200) {
    flagged = true;
    flaggedReason = `Calories too low: ${programData.nutrition.calories}`;
  }

  if (flagged) {
    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout || null,
      nutrition_plan: programData.nutrition || null,
      notes: programData.coach_notes || null,
      flagged: true,
      flagged_reason: flaggedReason
    });

    await notifyMaddy(
      'Program flagged for review',
      `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReason: ${flaggedReason}`
    );

    return jsonResponse(res, { ok: true, flagged: true, reason: flaggedReason });
  }

  // Generate PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      programData.workout,
      programData.nutrition,
      programData.coach_notes
    );
  } catch (err) {
    console.error('[Program] PDF generation error:', err.message);
    return errorResponse(res, 'PDF generation failed', 500);
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
    console.error('[Program] Upload error:', uploadError.message);
  }

  const { data: urlData } = db.storage
    .from('clients')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || '';

  // Save to programs table (audit trail)
  await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programData.workout || null,
    nutrition_plan: programData.nutrition || null,
    notes: programData.coach_notes || null,
    pdf_url: pdfUrl,
    flagged: false
  });

  // Send via WhatsApp
  const contextNote = programData.coach_notes
    ? `Week ${week_no} plan ready! ${programData.coach_notes}`
    : `Your Week ${week_no} program is ready! 💪 Check the PDF for your full workout + nutrition plan.`;

  const sendResult = await sendMediaMessage(client.phone, contextNote, pdfUrl);

  if (sendResult.ok) {
    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);
  }

  return jsonResponse(res, {
    ok: true,
    pdf_url: pdfUrl,
    week_no,
    flagged: false
  });
};
