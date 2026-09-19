#!/usr/bin/env node
/**
 * 본초죽염 칼럼 큐 자동 보충
 *
 *   node scripts/refill-queue.mjs --check      큐 잔량만 본다
 *   node scripts/refill-queue.mjs              부족하면 채운다(로컬만)
 *   node scripts/refill-queue.mjs --git        채운 뒤 커밋·푸시까지
 *   node scripts/refill-queue.mjs --force 3    잔량과 무관하게 3편
 *
 * 구조
 *   content/queue/<slug>.json 이 "초안 + publishAt" 이다.
 *   .github/workflows/publish-queue.yml 이 매일 00:10 KST 에 발행일이 된 것 한 편을
 *   content/columns.json 으로 옮기고 generate-columns.mjs 로 페이지를 다시 만든다.
 *
 *   발행 경로에는 LLM 이 끼지 않는다. 여기서 채우는 건 큐뿐이다.
 *   2026-09-05 이후 발행이 멈춘 원인도 워크플로 고장이 아니라 큐가 비어서였다.
 *   큐를 채워 주는 자동화가 이 사이트에만 없었다.
 *
 * 이 사이트가 특히 조심할 것
 *   죽염은 식품이다. 검색량이 가장 큰 말이 "죽염효능"(월 5,270회)인데,
 *   식품에 의학적 효능을 단정하면 식품표시광고법 위반이다.
 *   그래서 효능을 주장하는 대신 "무엇이 사실이고 무엇이 쓸 수 없는 표현인지" 를
 *   알려 주는 각도로 그 검색 의도를 받는다.
 *   생성 단계에서 scripts/validate-content.mjs 의 금지 패턴으로 미리 거르고,
 *   배포 전에 같은 검사기가 한 번 더 본다.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const QUEUE = path.join(ROOT, 'content', 'queue');
const BANK = path.join(ROOT, 'content', 'topic-bank.json');
const COLUMNS = path.join(ROOT, 'content', 'columns.json');
const LOG = path.join(ROOT, 'refill.log');
const LOCK = path.join(ROOT, '.refill.lock');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', '본초죽염_칼럼보충_실패.txt');

const THRESHOLD = 6;
const TARGET = 14;
const MAX_ADD = 6;
const RETRY = 2;
const BATCH_TIMEOUT = 30 * 60 * 1000;

// validate-content.mjs 와 같은 규칙. 여기서 먼저 걸러야 재작성 기회를 아낀다.
const BANNED = [
  /치료(?:에|하|해|가 된|된다|됩니다)/, /완치/, /특효/, /만병통치/, /항암/, /암을?\s*(?:예방|치료|낫)/,
  /(?:염증|질염|위염|식도염|비염|병|질병)\s*(?:이|을|가)?\s*(?:낫|치료|완치|사라)/,
  /질병을?\s*예방/, /살이?\s*빠(?:진|져|집)/, /살을?\s*빼/, /다이어트에?\s*효과/,
  /면역력(?:을|이)?\s*(?:높|길러|강화|올려|증진)/, /혈압을?\s*(?:낮|내려)/, /당뇨(?:에|를)?\s*(?:좋|효과|낫)/,
  /사마귀(?:가|를)?\s*(?:없|제거|사라|떨어)/, /부작용(?:이|은)?\s*없/, /100\s*%/, /무조건/,
];
const FAKE_REVIEW = [/내돈내산/, /직접 써보니 (?:병|증상|염증).*(?:나았|사라|없어)/];

const VALID_BLOCKS = ['heading', 'summary', 'list', 'table', 'callout', 'warning', 'infographic', 'help'];
const VISUALS = ['infographic', 'table', 'callout', 'warning'];

const CLAUDE = [
  'C:\\Users\\c\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe',
  'claude',
].find((p) => p === 'claude' || fs.existsSync(p));

const stamp = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch { }
}
const unlock = () => { try { fs.rmSync(LOCK); } catch { } };
function fail(msg, detail = '') {
  log('!! ' + msg);
  if (detail) log(String(detail).slice(0, 600));
  try {
    fs.writeFileSync(DESK, `${stamp()}\n본초죽염 칼럼 보충에 실패했습니다.\n\n${msg}\n\n${String(detail).slice(0, 1200)}\n`);
  } catch { }
  unlock();
  process.exit(1);
}
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } };
const len = (s) => [...String(s || '')].length;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const published = () => {
  const d = JSON.parse(fs.readFileSync(COLUMNS, 'utf8'));
  return Array.isArray(d) ? d : (d.columns ?? []);
};
const queueFiles = () => (fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).filter((f) => f.endsWith('.json')) : []);
const queueItems = () => queueFiles().map((f) => JSON.parse(fs.readFileSync(path.join(QUEUE, f), 'utf8')));

// validate-content.mjs 의 textOf 와 같은 규칙으로 본문을 펼친다.
const textOf = (body) => (body || []).map((b) => {
  if (typeof b === 'string') return b;
  if (!b || typeof b !== 'object') return '';
  if (b.type === 'heading') return b.text || '';
  if (b.type === 'summary') return `${b.title || ''} ${(b.items || []).join(' ')}`;
  if (b.type === 'list') return (b.items || []).join(' ');
  if (b.type === 'table') return [...(b.headers || []), ...(b.rows || []).flat()].join(' ');
  if (b.type === 'infographic') return (b.items || []).map((i) => `${i.title} ${i.text}`).join(' ');
  if (['callout', 'warning', 'help'].includes(b.type)) return `${b.label || ''} ${b.text || ''}`;
  return '';
}).join(' ');

/* ---------- 규격 검사 ---------- */
function validate(topic, date, seenTitles, seenSlugs) {
  const file = path.join(QUEUE, `${topic.slug}.json`);
  if (!fs.existsSync(file)) return [`${topic.slug}.json 이 없습니다`];
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return [`${topic.slug}.json JSON 오류: ${e.message}`]; }

  const e = [];
  for (const k of ['slug', 'publishAt', 'title', 'description', 'category', 'keywords', 'lead', 'body', 'faqs']) {
    if (d[k] === undefined || d[k] === '' || d[k] === null) e.push(`${k} 없음`);
  }
  if (e.length) return e.map((x) => `${topic.slug}: ${x}`);

  if (d.slug !== topic.slug) e.push(`slug 이 "${d.slug}" (배정 ${topic.slug})`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) e.push('slug 형식 오류(영문 소문자·하이픈)');
  if (d.category !== topic.category) e.push(`category 가 "${d.category}" (배정 ${topic.category})`);
  if (String(d.publishAt).slice(0, 10) !== date) e.push(`publishAt 이 "${d.publishAt}" (배정 ${date})`);
  if (seenSlugs.has(d.slug)) e.push(`slug 중복: ${d.slug}`);
  if (seenTitles.has(d.title)) e.push(`제목 중복: ${d.title}`);
  // validate-content.mjs 가 45~160자를 강제한다.
  if (len(d.description) < 45 || len(d.description) > 160) e.push(`description ${len(d.description)}자 (45~160)`);
  if (!Array.isArray(d.keywords) || d.keywords.length < 3) e.push('keywords 3개 미만');
  else if (!d.keywords.some((k) => String(k).replace(/\s/g, '').includes(topic.keyword.replace(/\s/g, '')))) {
    e.push(`keywords 에 타깃 "${topic.keyword}" 가 없습니다`);
  }

  if (!Array.isArray(d.body)) return [...e, `${topic.slug}: body 가 배열이 아닙니다`];
  let headings = 0; let visuals = 0;
  d.body.forEach((b, i) => {
    if (typeof b === 'string') { if (!b.trim()) e.push(`body[${i}] 빈 문단`); return; }
    if (!b || !b.type || !VALID_BLOCKS.includes(b.type)) { e.push(`body[${i}] 알 수 없는 블록: ${b?.type}`); return; }
    if (b.type === 'heading') { headings += 1; if (!b.text) e.push(`body[${i}] heading 에 text 없음`); }
    if (VISUALS.includes(b.type)) visuals += 1;
    if (b.type === 'table') {
      if (!Array.isArray(b.headers) || !b.headers.length) e.push(`body[${i}] table headers 없음`);
      else if (!Array.isArray(b.rows) || !b.rows.length) e.push(`body[${i}] table rows 없음`);
      else if (b.rows.some((r) => !Array.isArray(r) || r.length !== b.headers.length)) e.push(`body[${i}] table 행 길이 불일치`);
    }
    if (['callout', 'warning', 'help'].includes(b.type) && !b.text) e.push(`body[${i}] ${b.type} 에 text 없음`);
    if (b.type === 'summary' && (!Array.isArray(b.items) || !b.items.length)) e.push(`body[${i}] summary items 없음`);
  });
  if (d.body.length < 4) e.push(`body 블록이 ${d.body.length}개 (최소 4)`);
  if (headings < 4) e.push(`heading 이 ${headings}개 (최소 4)`);
  if (visuals < 1) e.push('비주얼(표·콜아웃·주의·인포그래픽)이 없습니다');
  if (!Array.isArray(d.faqs) || d.faqs.length < 3) e.push(`faqs 가 ${d.faqs?.length ?? 0}개 (최소 3)`);

  const full = [d.title, d.description, d.lead, textOf(d.body), (d.faqs || []).map((f) => `${f.q} ${f.a}`).join(' ')].join(' ');
  const plain = full.replace(/\s+/g, ' ');
  if (len(plain) < 2000) e.push(`본문이 짧습니다 (${len(plain)}자, 최소 2000)`);

  // 식품표시광고법 — 여기서 걸리면 배포 게이트에서도 걸린다. 미리 막는다.
  for (const re of BANNED) if (re.test(plain)) e.push(`금지 표현(효능 단정/보장): ${re}`);
  for (const re of FAKE_REVIEW) if (re.test(plain)) e.push(`후기 위장 표현: ${re}`);

  return e.map((x) => `${topic.slug}: ${x}`);
}

/* ---------- 프롬프트 ---------- */
function buildPrompt(topic, date, samples, titles, note) {
  return `너는 "본초죽염"(bonchojw.com)의 정보성 칼럼을 쓴다. 이번에 쓸 글은 1편이다.
죽염과 소금을 파는 곳이지만, 이 칼럼은 광고가 아니라 **소비자가 알아야 할 사실**을 알려 주는 글이다.

## 먼저 읽을 것
- AUTHORING.md — 집필 기준
- scripts/validate-content.mjs — **쓰면 안 되는 표현. 반드시 읽어라.**
- content/columns.json 의 기존 글 ${samples.map((s) => `"${s}"`).join(', ')} — 문체·구성·분량의 기준

## 이번 글
- 파일: content/queue/${topic.slug}.json
- slug: "${topic.slug}"
- category: "${topic.category}"
- publishAt: "${date}"
- 타깃 키워드: ${topic.keyword} (네이버 월 ${topic.vol}회)
- 다룰 내용: ${topic.angle}

## JSON 형식
{
  "slug": "${topic.slug}",
  "publishAt": "${date}",
  "title": "...",              // 검색 의도를 담되 과장 없이
  "description": "...",        // 45~160자
  "category": "${topic.category}",
  "keywords": ["${topic.keyword}", "...", "..."],
  "lead": "...",               // 첫 문단. 결론부터
  "body": [ ... ],
  "faqs": [{ "q": "...", "a": "..." }],   // 3개 이상
  "related": [{ "href": "/column/<실제 slug>/", "label": "..." }]
}

## body 에 쓸 수 있는 것
- 평범한 문단: 문자열 "..."
- { "type": "heading", "text": "소제목" }
- { "type": "summary", "title": "핵심 요약", "items": ["...", "..."] }
- { "type": "list", "items": ["...", "..."] }
- { "type": "table", "headers": ["...", "..."], "rows": [["...", "..."]] }
- { "type": "callout", "label": "짧은 라벨", "text": "..." }
- { "type": "warning", "label": "주의", "text": "..." }
- { "type": "help", "label": "...", "text": "..." }
- { "type": "infographic", "title": "...", "items": [{ "icon": "1", "title": "...", "text": "..." }] }

## 규칙
- 순수 텍스트 2,400~3,500자. heading 4~6개. 표·콜아웃 같은 비주얼 최소 1개.
- 검색해서 들어온 사람이 궁금한 것에 바로 답한다. 회사 소개로 시작하지 않는다.
- 문단은 1~3문장으로 짧게. 모바일 가독성 우선.

## 절대 쓰면 안 되는 것 — 식품표시광고법
죽염은 **식품**이다. 의학적 효능을 단정하는 순간 위법이고, 검사기가 배포를 막는다.
- 질병·증상 관련 일체 금지: "치료", "완치", "염증이 낫는다", "면역력을 높인다",
  "혈압을 낮춘다", "당뇨에 좋다", "항암", "질병 예방", "다이어트 효과" 전부 금지.
- "부작용 없", "100%", "무조건", "특효", "만병통치" 금지.
- 가짜 후기·체험 위장 금지("내돈내산", "써보니 증상이 사라졌다" 등).

**대신 이렇게 쓴다.** 효능을 묻는 검색에는 효능을 주장하지 말고,
제조 공정·표시사항·성분 표기·보관법처럼 **확인 가능한 사실**로 답한다.
"이런 표현은 식품에 쓸 수 없습니다" 라고 알려 주는 것도 좋은 답이다.
경쟁사·특정 브랜드를 깎아내리지 않는다. 가격을 본문에 적지 않는다.

## 기존 제목 (주제가 겹치면 안 된다)
${titles.map((t) => `- ${t}`).join('\n')}
${note ? `\n## 직전 시도에서 걸린 문제 — 반드시 고쳐라\n${note}\n` : ''}
content/queue/${topic.slug}.json 하나만 쓰고, 파일명만 출력하고 끝내라. git 등 다른 명령은 실행하지 마라.`;
}

function runClaude(text) {
  for (let t = 1; t <= 3; t += 1) {
    const res = spawnSync(CLAUDE, [
      '-p', text, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Glob,Grep',
    ], { cwd: ROOT, encoding: 'utf8', timeout: BATCH_TIMEOUT, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (!res.error && res.status === 0) return res;
    const why = String(res.stderr || res.stdout || res.error?.message || '').trim().slice(-400);
    log(`  !! claude 호출 실패 (${res.status ?? 'error'}) ${t}/3 — ${why || '출력 없음'}`);
    if (t < 3) { log('  60초 쉬었다가 다시 부릅니다'); sleep(60000); }
  }
  return null;
}

/* ---------- 본체 ---------- */
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const GIT = argv.includes('--git');
const fi = argv.indexOf('--force');
const FORCE = fi >= 0 ? Math.max(1, Math.min(MAX_ADD, Number(argv[fi + 1]) || 1)) : 0;

fs.mkdirSync(QUEUE, { recursive: true });

if (GIT) {
  try { git(['fetch', 'origin', 'main']); git(['merge', '--ff-only', 'origin/main']); log('원격 반영'); }
  catch (e) { fail('원격과 갈라짐 — 로컬 변경을 정리해야 합니다', String(e.stdout || e.message)); }

  // 추적되지 않은 큐 파일이 남아 있으면 먼저 올린다.
  // 발행은 원격 큐를 꺼내 쓰는데 이 스크립트는 로컬 파일을 센다. 둘이 어긋나면
  // "큐 있음 → 보충 불필요" 로 끝나고 원격은 빈 채로 발행이 멈춘다(taegyue 에서 실제로 겪음).
  try {
    const stray = git(['ls-files', '--others', '--exclude-standard', '--', 'content/queue'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
    if (stray.length) {
      log(`!! 추적되지 않은 큐 ${stray.length}편 발견 — 먼저 올립니다`);
      git(['add', '--', 'content/queue']);
      git(['-c', 'core.autocrlf=false', 'commit', '-q', '-m', `큐 누락분 ${stray.length}편 올림`]);
      git(['push', '-q', 'origin', 'main']);
      log('   올림 완료');
    }
  } catch (e) {
    fail('추적되지 않은 큐를 올리지 못했습니다', String(e.stdout || e.message));
  }
}

const live = published();
const q = queueItems().sort((a, b) => String(a.publishAt).localeCompare(String(b.publishAt)));
const lastAt = [...live.map((c) => c.datePublished), ...q.map((c) => String(c.publishAt).slice(0, 10))]
  .filter(Boolean).sort().at(-1) || TODAY;

log(`─── 큐 점검 (KST ${TODAY}) ─── 발행 ${live.length}편 · 큐 ${q.length}편 · 마지막 예약일 ${lastAt}`);
if (CHECK) {
  q.forEach((c) => console.log(`  ${String(c.publishAt).slice(0, 10)}  ${c.slug}  ${c.title}`));
  process.exit(0);
}

const bank = JSON.parse(fs.readFileSync(BANK, 'utf8')).topics;
const usedSlugs = new Set([...live.map((c) => c.slug), ...q.map((c) => c.slug)]);
const free = bank.filter((t) => !usedSlugs.has(t.slug));

const need = FORCE || (q.length < THRESHOLD ? Math.min(MAX_ADD, TARGET - q.length) : 0);
if (need <= 0) { log(`큐 ${q.length}편 — 보충 불필요(기준 ${THRESHOLD})`); process.exit(0); }

if (!free.length) fail('주제 배정표가 비었습니다', `content/topic-bank.json 에 새 주제를 추가해야 ${lastAt} 이후로 발행이 이어집니다.`);
if (free.length < need) log(`!! 배정표에 남은 주제가 ${free.length}개뿐입니다 — 곧 채워 넣어야 합니다`);

if (fs.existsSync(LOCK)) {
  if (Date.now() - fs.statSync(LOCK).mtimeMs < BATCH_TIMEOUT * 2) { log('이미 실행 중 — 종료'); process.exit(0); }
  unlock();
}
fs.writeFileSync(LOCK, stamp());

const targets = free.slice(0, Math.min(need, free.length));
const base = lastAt > TODAY ? lastAt : TODAY;
const plan = targets.map((t, i) => ({ topic: t, date: addDays(base, i + 1) }));
log(`${plan.length}건 보충 시작 → ${plan[0].date} ~ ${plan[plan.length - 1].date}`);

const seenTitles = new Set([...live.map((c) => c.title), ...q.map((c) => c.title)]);
const seenSlugs = new Set(usedSlugs);
const written = [];

for (const { topic, date } of plan) {
  const samples = live.filter((c) => c.category === topic.category).slice(-2).map((c) => c.slug);
  if (!samples.length && live.length) samples.push(live.at(-1).slug);

  let note = '';
  let ok = false;
  for (let attempt = 0; attempt <= RETRY; attempt += 1) {
    if (attempt) log(`  재작성 ${attempt}회차 — ${topic.slug}`);
    try { fs.rmSync(path.join(QUEUE, `${topic.slug}.json`)); } catch { }

    if (!runClaude(buildPrompt(topic, date, samples, [...seenTitles], note))) {
      fail('claude 를 세 번 불렀지만 모두 실패했습니다 (사용량 한도로 보입니다)',
        `여기까지 ${written.length}건은 남아 있습니다. 다시 실행하면 이어서 씁니다.`);
    }
    const errs = validate(topic, date, seenTitles, seenSlugs);
    if (!errs.length) { ok = true; break; }
    note = errs.map((x) => `- ${x}`).join('\n');
    log(`  !! 규격 불통과 ${topic.slug}: ${errs.slice(0, 3).join(' / ')}`);
  }
  if (!ok) {
    try { fs.rmSync(path.join(QUEUE, `${topic.slug}.json`)); } catch { }
    log(`  건너뜀 — ${topic.slug} 가 ${RETRY + 1}회 모두 규격 미달`);
    continue;
  }

  const d = JSON.parse(fs.readFileSync(path.join(QUEUE, `${topic.slug}.json`), 'utf8'));
  seenTitles.add(d.title);
  seenSlugs.add(d.slug);
  written.push(d);
  try { fs.writeFileSync(LOCK, stamp()); } catch { }
  log(`  통과 ${date}  ${topic.slug} — ${d.title}`);
}

if (!written.length) fail('한 편도 규격을 통과하지 못했습니다');

// 배포 게이트와 같은 검사기를 한 번 더 돌린다(큐까지 포함해서 본다).
log('발행 검수 확인 중…');
try {
  execFileSync(process.execPath, [path.join(HERE, 'validate-content.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  log('검수 통과');
} catch (e) {
  const why = String(e.stdout || '') + String(e.stderr || e.message || '');
  written.forEach((d) => { try { fs.rmSync(path.join(QUEUE, `${d.slug}.json`)); } catch { } });
  fail('검수에서 걸려 전부 되돌렸습니다', why.slice(-1200));
}

if (GIT) {
  try {
    git(['add', '--', 'content/queue', 'content/topic-bank.json']);
    git(['-c', 'core.autocrlf=false', 'commit', '-q', '-m', `칼럼 큐 보충: ${written.length}편 (${plan[0].date} ~)`]);
    git(['push', '-q', 'origin', 'main']);
    log('GitHub 푸시 완료 — publish-queue 가 매일 00:10 KST 에 한 편씩 발행');
  } catch (e) {
    fail('커밋·푸시 실패', String(e.stdout || e.stderr || e.message));
  }
}

log(`─── 보충 완료 · ${written.length}편 (배정표 잔여 ${free.length - written.length}개) ───`);
try { if (fs.existsSync(DESK)) fs.rmSync(DESK); } catch { }
unlock();
