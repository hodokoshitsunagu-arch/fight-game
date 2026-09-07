const PROMPT_TYPES = new Set(['collect', 'dialogue', 'quiz', 'puzzle']);
const COMBAT_TYPES = new Set(['combat', 'boss']);

export const INTERACTION_REGISTRY = Object.freeze({
  collect: { mode: 'prompt', label: '观察收集' },
  dialogue: { mode: 'prompt', label: '对话选择' },
  quiz: { mode: 'prompt', label: '历史答题' },
  puzzle: { mode: 'prompt', label: '环境解谜' },
  combat: { mode: 'combat', label: '异常净化' },
  boss: { mode: 'combat', label: '章末挑战' }
});

export function interactionMode(interaction) {
  return INTERACTION_REGISTRY[interaction?.type]?.mode ?? null;
}

export function interactionLabel(interaction) {
  return INTERACTION_REGISTRY[interaction?.type]?.label ?? '互动';
}

export function navigationBrief(anchor, fromAnchor = null) {
  const movement = !fromAnchor
    ? `跨城抵达 ${anchor?.name ?? '下一地点'}`
    : anchor?.transition === 'walk'
      ? `尝试沿街景链接从 ${fromAnchor.name} 步行到 ${anchor.name}；链接失效时自动淡出转场。`
      : `从 ${fromAnchor.name} 淡出转场到 ${anchor?.name ?? '下一地点'}。`;
  const interaction = anchor?.interaction;
  const followUp = interaction?.followUp
    ? `；随后完成${interaction.followUp.label ?? '地点解谜'}才能前进`
    : '';
  const nextTask = interaction
    ? `下一步：${interactionLabel(interaction)}｜${interaction.prompt ?? ''}${followUp}`
    : '下一步：观察新地点。';
  return { movement, nextTask };
}

export function answerOptions(interaction) {
  if (!interaction) return [];
  if (interaction.type === 'dialogue') return interaction.choices ?? [];
  return (interaction.choices ?? []).map((choice, index) => ({
    id: String(index),
    label: typeof choice === 'string' ? choice : choice.label
  }));
}

export function gradeInteraction(interaction, answer) {
  if (!interaction) return { accepted: false, correct: false };
  if (interaction.type === 'collect') return { accepted: true, correct: true };
  if (interaction.type === 'dialogue') {
    const selected = (interaction.choices ?? []).find((choice) => choice.id === answer);
    return selected
      ? { accepted: true, correct: true, choiceId: selected.id, effect: selected.effect }
      : { accepted: false, correct: false };
  }
  if (!PROMPT_TYPES.has(interaction.type)) return { accepted: false, correct: false };
  const selectedIndex = Number(answer);
  const accepted = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < (interaction.choices?.length ?? 0);
  return { accepted, correct: accepted && selectedIndex === interaction.correct };
}

export function gradeFollowUp(followUp, answer) {
  if (!followUp) return { accepted: false, correct: false };
  const selectedIndex = Number(answer);
  const accepted = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < (followUp.choices?.length ?? 0);
  return { accepted, correct: accepted && selectedIndex === followUp.correct };
}

export function hintFor(interaction, attempt, fact = '') {
  if (attempt <= 0) return '';
  if (attempt === 1) {
    return '回到地点线索：答案来自眼前的史实，而不是奇幻异常。';
  }
  if (attempt === 2) {
    const correct = interaction?.choices?.[interaction.correct];
    const label = typeof correct === 'string' ? correct : correct?.label;
    return label ? `答案开头是：“${String(label).slice(0, 18)}…”` : fact;
  }
  const correct = interaction?.choices?.[interaction.correct];
  return `已解除阻塞。正确答案：${typeof correct === 'string' ? correct : correct?.label ?? fact}`;
}

export function isCombatInteraction(interaction) {
  return COMBAT_TYPES.has(interaction?.type);
}
