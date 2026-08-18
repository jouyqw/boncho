// 본초죽염 칼럼 컴플라이언스 + 품질 린터
// 사용: node scripts/validate-content.mjs
// 목적: 자동 발행되는 칼럼이 (1) 식품의 의학적 효능 단정, (2) 가짜 후기, (3) 과장/보장 표현으로
//       새지 않도록, 그리고 최소 품질(분량·구조·중복)을 지키도록 강제한다. 실패 시 exit 1.

import { readFileSync } from 'node:fs';

const errors = [];
const cols = JSON.parse(readFileSync('content/columns.json', 'utf8'));

// 식품(소금/죽염)에 의학적 효능·질병 치료를 단정하거나, 결과를 보장하는 표현 패턴
const BANNED = [
  /치료(?:에|하|해|가 된|된다|됩니다)/, /완치/, /특효/, /만병통치/, /항암/, /암을?\s*(?:예방|치료|낫)/,
  /(?:염증|질염|위염|식도염|비염|병|질병)\s*(?:이|을|가)?\s*(?:낫|치료|완치|사라)/,
  /질병을?\s*예방/, /살이?\s*빠(?:진|져|집)/, /살을?\s*빼/, /다이어트에?\s*효과/,
  /면역력(?:을|이)?\s*(?:높|길러|강화|올려|증진)/, /혈압을?\s*(?:낮|내려)/, /당뇨(?:에|를)?\s*(?:좋|효과|낫)/,
  /사마귀(?:가|를)?\s*(?:없|제거|사라|떨어)/, /부작용(?:이|은)?\s*없/, /100\s*%/, /무조건/,
];
// 가짜 후기/체험 위장 신호
const FAKE_REVIEW = [/내돈내산/, /직접 써보니 (?:병|증상|염증).*(?:나았|사라|없어)/];

const textOf = (body) => body.map((b) => {
  if (typeof b === 'string') return b;
  if (b.type === 'heading') return b.text || '';
  if (b.type === 'summary') return (b.title || '') + ' ' + (b.items || []).join(' ');
  if (b.type === 'list') return (b.items || []).join(' ');
  if (b.type === 'table') return [...(b.headers || []), ...(b.rows || []).flat()].join(' ');
  if (b.type === 'infographic') return (b.items || []).map((i) => `${i.title} ${i.text}`).join(' ');
  if (b.type === 'callout' || b.type === 'warning' || b.type === 'help') return (b.label || '') + ' ' + (b.text || '');
  return '';
}).join(' ');

const tokens = (t) => new Set(String(t).toLowerCase().replace(/[^가-힣a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1));
const similarity = (a, b) => { const l = tokens(a), r = tokens(b); const c = [...l].filter((w) => r.has(w)).length; return c / Math.max(1, l.size + r.size - c); };

const slugs = new Set();
const titles = new Set();
const texts = [];

for (const c of cols) {
  const id = c.slug || '(slug 없음)';
  if (!c.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)) errors.push(`${id}: slug 형식 오류(영문 소문자·하이픈).`);
  if (slugs.has(c.slug)) errors.push(`${id}: slug 중복.`); else slugs.add(c.slug);
  if (!c.title) errors.push(`${id}: title 없음.`);
  else if (titles.has(c.title)) errors.push(`${id}: title 중복.`); else titles.add(c.title);
  if (!c.description || [...c.description].length < 45 || [...c.description].length > 160) errors.push(`${id}: description 45~160자 필요(현재 ${c.description ? [...c.description].length : 0}).`);
  if (!c.category) errors.push(`${id}: category 없음.`);
  if (!c.datePublished || !/^\d{4}-\d{2}-\d{2}$/.test(c.datePublished)) errors.push(`${id}: datePublished(YYYY-MM-DD) 필요.`);
  if (!c.lead) errors.push(`${id}: lead(요지 답변) 없음.`);
  if (!Array.isArray(c.body) || c.body.length < 4) errors.push(`${id}: body 블록이 부족.`);
  if (!Array.isArray(c.faqs) || c.faqs.length < 3) errors.push(`${id}: FAQ 3개 이상 필요.`);

  const body = Array.isArray(c.body) ? c.body : [];
  const headings = body.filter((b) => b && b.type === 'heading').length;
  if (headings < 4) errors.push(`${id}: 소제목(heading) 4개 이상 필요(현재 ${headings}).`);
  const visuals = body.filter((b) => b && ['infographic', 'table', 'callout', 'warning'].includes(b.type)).length;
  if (visuals < 1) errors.push(`${id}: 비주얼(인포그래픽/표/콜아웃/주의) 1개 이상 필요.`);

  const full = [c.title, c.description, c.lead, textOf(body), (c.faqs || []).map((f) => `${f.q} ${f.a}`).join(' ')].join(' ');
  const plain = full.replace(/\s+/g, ' ');
  const len = [...textOf(body).replace(/\s+/g, '')].length;
  if (len < 1500) errors.push(`${id}: 본문이 너무 짧음(${len}자, 최소 1500·권장 2000+).`);

  for (const re of BANNED) if (re.test(plain)) errors.push(`${id}: 금지 표현(효능 단정/보장) 감지 → ${re}`);
  for (const re of FAKE_REVIEW) if (re.test(plain)) errors.push(`${id}: 가짜 후기/체험 위장 표현 감지 → ${re}`);

  texts.push({ id, t: textOf(body) });
}

for (let i = 0; i < texts.length; i += 1)
  for (let j = i + 1; j < texts.length; j += 1) {
    const s = similarity(texts[i].t, texts[j].t);
    if (s >= 0.85) errors.push(`${texts[i].id} ↔ ${texts[j].id}: 본문 유사도 과다(${(s * 100).toFixed(1)}%).`);
  }

if (errors.length) {
  console.error(`Content validation FAILED (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Content validation passed: ${cols.length} columns`);
