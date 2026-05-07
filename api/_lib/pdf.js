const { supabase } = require('./supabase');

function buildHTML(clientData, weekNo, workoutPlan, nutritionPlan) {
  const clientName = clientData.name || 'Client';
  const clientGoal = clientData.goal || '';
  const notes = clientData.notes || '';

  const workoutRows = (workoutPlan || []).map(day => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#B8965A;font-family:'Bebas Neue',sans-serif;font-size:16px;white-space:nowrap;">${day.day || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#e0e0e0;">${day.focus || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#e0e0e0;">${(day.exercises || []).join('<br>')}</td>
    </tr>`).join('');

  const nutritionRows = (nutritionPlan || []).map(meal => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#B8965A;font-family:'Bebas Neue',sans-serif;font-size:16px;">${meal.meal || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#e0e0e0;">${meal.foods || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#e0e0e0;">${meal.calories || ''}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #333;color:#e0e0e0;">${meal.protein || ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fitness by Maddy - Week ${weekNo} Program</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#111; color:#e0e0e0; font-family:'DM Sans',sans-serif; font-size:15px; line-height:1.6; }
  .header { background:#000; padding:40px 32px; text-align:center; border-bottom:3px solid #B8965A; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:42px; color:#B8965A; letter-spacing:3px; }
  .header p { color:#888; font-size:14px; margin-top:6px; }
  .container { max-width:800px; margin:0 auto; padding:32px 24px; }
  .section { margin-bottom:36px; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:26px; color:#B8965A; border-bottom:2px solid #B8965A; padding-bottom:8px; margin-bottom:16px; letter-spacing:2px; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .info-item { background:#1a1a1a; padding:14px 18px; border-radius:6px; }
  .info-label { color:#888; font-size:12px; text-transform:uppercase; letter-spacing:1px; }
  .info-value { color:#fff; font-size:16px; font-weight:500; margin-top:2px; }
  table { width:100%; border-collapse:collapse; background:#1a1a1a; border-radius:6px; overflow:hidden; }
  th { background:#222; color:#B8965A; font-family:'Bebas Neue',sans-serif; font-size:15px; letter-spacing:1px; padding:12px 14px; text-align:left; }
  .notes { background:#1a1a1a; padding:20px 24px; border-radius:6px; border-left:4px solid #B8965A; }
  .footer { text-align:center; padding:32px; color:#555; font-size:12px; border-top:1px solid #222; margin-top:40px; }
</style>
</head>
<body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <p>Personalised Program &mdash; Week ${weekNo}</p>
</div>
<div class="container">
  <div class="section">
    <div class="section-title">Client Information</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Name</div><div class="info-value">${clientName}</div></div>
      <div class="info-item"><div class="info-label">Week</div><div class="info-value">${weekNo}</div></div>
      ${clientGoal ? `<div class="info-item" style="grid-column:span 2"><div class="info-label">Goal</div><div class="info-value">${clientGoal}</div></div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Workout Plan</div>
    <table>
      <thead><tr><th>Day</th><th>Focus</th><th>Exercises</th></tr></thead>
      <tbody>${workoutRows || '<tr><td colspan="3" style="padding:14px;color:#888;">No workout data</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Nutrition Plan</div>
    <table>
      <thead><tr><th>Meal</th><th>Foods</th><th>Calories</th><th>Protein</th></tr></thead>
      <tbody>${nutritionRows || '<tr><td colspan="4" style="padding:14px;color:#888;">No nutrition data</td></tr>'}</tbody>
    </table>
  </div>

  ${notes ? `<div class="section"><div class="section-title">Notes</div><div class="notes">${notes}</div></div>` : ''}
</div>
<div class="footer">
  &copy; Fitness by Maddy &mdash; This program is personalised and confidential. Do not redistribute.
</div>
</body>
</html>`;
}

async function generateProgramPDF(clientData, weekNo, workoutPlan, nutritionPlan) {
  const html = buildHTML(clientData, weekNo, workoutPlan, nutritionPlan);
  const buffer = Buffer.from(html, 'utf-8');
  const clientId = clientData.id || clientData.client_id || 'unknown';
  const filePath = `clients/${clientId}/week_${weekNo}.html`;

  const { error } = await supabase.storage
    .from('programs')
    .upload(filePath, buffer, {
      contentType: 'text/html',
      upsert: true,
    });

  if (error) {
    console.error(`Failed to upload program HTML for client ${clientId}:`, error.message);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from('programs')
    .getPublicUrl(filePath);

  return {
    buffer,
    filePath,
    publicUrl: urlData?.publicUrl || null,
  };
}

module.exports = { generateProgramPDF };
