const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { createProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

const RISKY_PATTERNS = [
  /below\s+\d{3}\s*cal/i,
  /\b(dnp|clenbuterol|sarm|steroid|hgh)\b/i,
  /lose\s+\d{2,}\s*(kg|lb|pound).*per\s*week/i,
  /extreme\s+(cut|deficit|fast)/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getClient();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a weekly workout and nutrition plan as JSON. Be specific with exercises, sets, reps, rest times.
Nutrition must include daily calories, macro breakdown, and meal suggestions.
NEVER recommend: banned substances, extreme calorie restriction (<1200 cal for women, <1500 for men), unrealistic timelines.
Always prioritize safety, progressive overload, and sustainability.`;

    const userPrompt = `Create Week ${week_no} program for this client:
Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:\n${JSON.stringify(recentCheckins, null, 2)}` : 'No check-ins yet (first week).'}

${prevPrograms && prevPrograms.length > 0 ? `Previous week plan:\n${JSON.stringify(prevPrograms[0], null, 2)}` : 'No previous program (first week).'}

Return ONLY valid JSON in this format:
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "Oats 50g"] }
    ]
  },
  "notes": "Focus areas and tips for the week"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain valid JSON');
    }

    const plan = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(plan);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));

    if (isRisky) {
      await escalateToMaddy('Program flagged for risky content', {
        phone: client.phone,
        name: client.name,
        clientId: client_id,
        message: `Week ${week_no} program contains potentially risky recommendations. Review before sending.`
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await createProgramPDF(
      client,
      week_no,
      plan.workout,
      plan.nutrition,
      plan.notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: plan.workout,
      nutrition_plan: plan.nutrition,
      notes: plan.notes || ''
    });

    if (insertError) throw insertError;

    const contextNote = plan.notes
      ? plan.notes.slice(0, 150)
      : `Week ${week_no} is ready! Focus on progressive overload and consistency.`;

    await sendWhatsApp(
      client.phone,
      `Your Week ${week_no} program is here! ${contextNote}\n\nPDF: ${pdfUrl}`,
      null,
      true
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    console.log(`Program generated for client ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
