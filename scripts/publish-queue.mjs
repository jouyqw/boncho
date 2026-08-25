/**
 * 예약 칼럼 발행기 — node scripts/publish-queue.mjs [--dry]
 *
 * content/queue/*.json 중 publishAt 이 오늘(KST) 이하인 글 한 편을
 * data/columns.json 배열 끝에 붙인다. 이후 generate-columns.mjs 는 워크플로가 실행한다.
 *
 * 왜 이렇게 하나: 매일 칼럼을 쓰던 클라우드 예약 세션이 조용히 실패하는 날이 많았다.
 * 세션은 매일 실행됐는데 커밋이 들어오지 않아 8/15 이후 발행이 끊겼다. 그래서
 * "글 쓰기"와 "글 내보내기"를 분리한다. 내보내기에는 LLM 이 끼지 않는다.
 */

import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const QUEUE = path.join('content', 'queue');
const COLUMNS = path.join('content', 'columns.json');

const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
console.log(`KST 오늘 = ${today}`);

const out = process.env.GITHUB_OUTPUT;
const emit = (line) => {
  if (out) fs.appendFileSync(out, `${line}\n`);
};

if (!fs.existsSync(QUEUE)) {
  console.log('큐 폴더가 없습니다. 발행할 것이 없습니다.');
  emit('published=0');
  process.exit(0);
}

const columns = JSON.parse(fs.readFileSync(COLUMNS, 'utf8'));
const known = new Set(columns.map((c) => c.slug));

const files = fs.readdirSync(QUEUE).filter((f) => f.endsWith('.json')).sort();
const due = [];
for (const f of files) {
  const item = JSON.parse(fs.readFileSync(path.join(QUEUE, f), 'utf8'));
  const at = String(item.publishAt || item.datePublished || '').slice(0, 10);
  if (at && at <= today) due.push({ f, item, at });
}

if (!due.length) {
  console.log(`발행일이 된 글이 없습니다. 큐에 ${files.length}편 남아 있습니다.`);
  emit('published=0');
  process.exit(0);
}

// 밀린 날짜가 여러 개여도 하루 한 편만 낸다. 한꺼번에 쏟으면 대량생성 신호가 된다.
due.sort((a, b) => a.at.localeCompare(b.at));
const [{ f, item, at }] = due;

if (known.has(item.slug)) {
  console.warn(`건너뜀 ${item.slug} — 이미 발행된 글입니다. 큐에서만 제거합니다.`);
  if (!DRY) fs.rmSync(path.join(QUEUE, f));
  emit('published=0');
  process.exit(0);
}

const { publishAt, ...rest } = item;
const entry = {
  ...rest,
  datePublished: rest.datePublished || at,
  dateModified: rest.dateModified || at,
};

if (DRY) {
  console.log(`[dry] ${entry.slug} (${at}) — ${entry.title}`);
  process.exit(0);
}

columns.push(entry);
fs.writeFileSync(COLUMNS, `${JSON.stringify(columns, null, 2)}\n`, 'utf8');
fs.rmSync(path.join(QUEUE, f));

emit('published=1');
emit(`summary=${entry.title.slice(0, 180)}`);
console.log(`\n발행 ${entry.slug} (${at}), 큐 잔량 ${files.length - 1}편`);
