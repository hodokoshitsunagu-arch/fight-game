function wrap(context, text, x, y, maxWidth, lineHeight) {
  const characters = [...text];
  let line = '';
  for (const character of characters) {
    const candidate = line + character;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y);
      y += lineHeight;
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, y);
  return y;
}

export async function createCultureCardBlob(ending) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('culture-card-canvas-unavailable');
  context.fillStyle = '#07111b';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#78c8ff';
  context.fillRect(80, 90, 12, 1320);
  context.fillStyle = '#e9f4ff';
  context.font = '700 64px system-ui, sans-serif';
  wrap(context, ending?.title ?? '纽约文化卡', 130, 210, 950, 82);
  context.fillStyle = '#90a9bd';
  context.font = '500 30px system-ui, sans-serif';
  context.fillText('失序的城市档案 · 案件文化卡', 130, 390);
  context.fillStyle = '#ffffff';
  context.font = '600 42px system-ui, sans-serif';
  context.fillText('案件客观谜底', 130, 520);
  context.font = '400 36px system-ui, sans-serif';
  const truthBottom = wrap(context, ending?.caseTruth ?? '', 130, 600, 930, 58);
  context.fillStyle = '#ffffff';
  context.font = '600 42px system-ui, sans-serif';
  context.fillText('与城市总谜团的联系', 130, truthBottom + 150);
  context.font = '400 36px system-ui, sans-serif';
  wrap(context, ending?.cityMystery ?? '', 130, truthBottom + 230, 930, 58);
  context.fillStyle = '#90a9bd';
  context.font = '400 26px system-ui, sans-serif';
  context.fillText('本卡由浏览器在完成案件后生成，不包含玩家身份或自由文本。', 130, 1360);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('culture-card-render-failed'));
  }, 'image/png'));
}
