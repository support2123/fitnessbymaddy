export function generateProgramHTML(client, weekNo, workout, nutrition, notes) {
  const workoutRows = (workout.days || []).map(day => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E3DC;font-weight:600;color:#2C2C2C;width:120px;vertical-align:top;">${day.name}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #E8E3DC;color:#2C2C2C;">
        ${(day.exercises || []).map(ex => `
          <div style="margin-bottom:6px;">
            <strong>${ex.name}</strong> — ${ex.sets} x ${ex.reps}${ex.rest ? ` (rest: ${ex.rest})` : ''}
            ${ex.notes ? `<br><span style="color:#6B6B6B;font-size:12px;">${ex.notes}</span>` : ''}
          </div>
        `).join('')}
      </td>
    </tr>
  `).join('');

  const nutritionHTML = `
    <div style="margin-bottom:8px;"><strong>Daily Calories:</strong> ${nutrition.calories || 'As prescribed'}</div>
    <div style="margin-bottom:8px;"><strong>Protein:</strong> ${nutrition.protein || '-'}g &nbsp;|&nbsp; <strong>Carbs:</strong> ${nutrition.carbs || '-'}g &nbsp;|&nbsp; <strong>Fat:</strong> ${nutrition.fat || '-'}g</div>
    ${nutrition.meals ? `
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        ${nutrition.meals.map(meal => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #E8E3DC;font-weight:600;width:100px;color:#2C2C2C;">${meal.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #E8E3DC;color:#6B6B6B;">${meal.description}</td>
          </tr>
        `).join('')}
      </table>
    ` : ''}
    ${nutrition.notes ? `<div style="margin-top:12px;color:#6B6B6B;font-style:italic;">${nutrition.notes}</div>` : ''}
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
    body { font-family: 'DM Sans', sans-serif; margin: 0; padding: 0; background: #FAF8F4; color: #2C2C2C; }
  </style>
</head>
<body>
  <div style="max-width:800px;margin:0 auto;padding:40px;">
    <!-- Header -->
    <div style="background:#2C2C2C;padding:32px 40px;margin-bottom:0;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:4px;color:#B8965A;margin-bottom:8px;">FITNESS BY MADDY</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:36px;color:white;letter-spacing:2px;">WEEK ${weekNo} PROGRAM</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:8px;">${client.name || 'Client'} &nbsp;|&nbsp; ${client.program ? client.program.replace(/_/g, ' ').toUpperCase() : ''}</div>
    </div>

    <!-- Gold accent bar -->
    <div style="height:4px;background:linear-gradient(90deg,#B8965A,#D4AF7A);"></div>

    <!-- Workout Section -->
    <div style="background:white;padding:32px 40px;margin-bottom:2px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#2C2C2C;margin-bottom:20px;">WORKOUT PLAN</div>
      ${workout.focus ? `<div style="margin-bottom:16px;padding:12px 16px;background:#FAF8F4;border-left:3px solid #B8965A;font-size:14px;color:#6B6B6B;"><strong>Focus:</strong> ${workout.focus}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;">
        ${workoutRows}
      </table>
      ${workout.notes ? `<div style="margin-top:16px;font-size:13px;color:#6B6B6B;font-style:italic;">${workout.notes}</div>` : ''}
    </div>

    <!-- Nutrition Section -->
    <div style="background:white;padding:32px 40px;margin-bottom:2px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#2C2C2C;margin-bottom:20px;">NUTRITION PLAN</div>
      ${nutritionHTML}
    </div>

    <!-- Notes -->
    ${notes ? `
    <div style="background:white;padding:32px 40px;margin-bottom:2px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#2C2C2C;margin-bottom:16px;">COACH NOTES</div>
      <div style="font-size:14px;line-height:1.7;color:#6B6B6B;">${notes}</div>
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="background:#2C2C2C;padding:20px 40px;text-align:center;">
      <div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:1px;">CONFIDENTIAL — PREPARED EXCLUSIVELY FOR ${(client.name || 'CLIENT').toUpperCase()}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:4px;">fitnessbymaddy.com</div>
    </div>
  </div>
</body>
</html>`;
}
