const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsAppToClient } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /\b(clenbuterol|dnp|ephedra|steroids?|sarms?|testosterone)\b/i,
  /lose\s*(10|15|20)\+?\s*kg.*in\s*(1|2)\s*week/i,
  /extreme\s*(fast|cut|deficit)/i,
  /\bvlcd\b/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You design weekly workout and nutrition plans for clients on the 12-week custom training program.

Rules:
- Be evidence-based. No bro science.
- Never recommend banned substances, extreme calorie deficits (<1200 cal for women, <1500 for men), or unrealistic timelines.
- Programs should be progressive — build on previous weeks.
- Include warm-up and cooldown in every workout day.
- Nutrition should be sustainable and culturally appropriate.
- Output MUST be valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan format:
{
  "days": [
    { "day": "Monday", "focus": "Upper Body Push", "exercises": [
      { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
    ]}
  ]
}

nutrition_plan format:
{
  "calories": 2200,
  "macros": { "protein": "180g", "carbs": "220g", "fat": "65g" },
  "meals": [
    { "name": "Meal 1 - Breakfast", "time": "7:00 AM", "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with berries"] }
  ],
  "supplements": ["Whey protein post-workout", "Creatine 5g daily"],
  "hydration": "3-4 liters water daily",
  "notes": "Any special notes"
}

Also include a "coach_notes" string with a 2-3 sentence personalized note for the client.`;

    const checkinContext = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
      : 'No check-in data yet (first week).';

    const prevContext = previousPrograms && previousPrograms.length > 0
      ? `Previous week plan summary: ${JSON.stringify(previousPrograms[0].workout_plan?.days?.map(d => d.focus) || [])}`
      : 'No previous program (first week).';

    const userPrompt = `Generate Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: 12-Week Custom Training
Current program week: ${week_no}/12

Recent check-in data:
${checkinContext}

${prevContext}

Provide the complete workout and nutrition plan as JSON. Include "workout_plan", "nutrition_plan", and "coach_notes" keys.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program from AI response' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const { workout_plan, nutrition_plan, coach_notes } = programData;

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));

    if (isRisky) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'AI-generated program flagged for safety review',
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program contains potentially risky recommendations. Halted auto-send.`
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan,
        nutrition_plan,
        notes: `[FLAGGED FOR REVIEW] ${coach_notes || ''}`
      });

      return res.status(200).json({
        success: true,
        flagged: true,
        message: 'Program flagged for Maddy review — not auto-sent'
      });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: workout_plan,
      nutritionPlan: nutrition_plan,
      notes: coach_notes
    });

    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;

    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes: coach_notes || '',
      whatsapp_sent_at: new Date().toISOString()
    });

    await sendWhatsAppToClient(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no)],
      `Your Week ${week_no} program is ready! ${coach_notes || ''}`
    );

    return res.status(200).json({
      success: true,
      programWeek: week_no,
      pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
