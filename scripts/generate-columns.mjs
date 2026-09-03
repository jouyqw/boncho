// 본초죽염 칼럼 게시판 렌더러 (bonchojw.com/column)
// 사용: node scripts/generate-columns.mjs
// content/columns.json 을 읽어 각 칼럼 상세 페이지 + 게시판 목록 + sitemap/rss/llms 를 생성합니다.
// 의학적 효능 단정·가짜 후기 없이, 정보 중심의 건강 상식 칼럼을 만듭니다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const site = 'https://bonchojw.com';
const brand = '본초죽염';
const cafeUrl = 'https://cafe.naver.com/healthnothes/4';
const productGo = '/go?to=product&utm_source=column&utm_medium=article';

const esc = (v = '') => String(v)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const mdBold = (v = '') => esc(v).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const STYLE = `:root{--green:#03c75a;--green-d:#009f47;--navy:#12324a;--teal:#1f6f78;--teal-soft:#e7f3f2;--gold:#b98a2e;--ink:#20303a;--muted:#5f6f77;--line:#e2ebe9;--bg:#f4f8f7;--soft:#f8fbfa}
*{box-sizing:border-box}body{margin:0;font-family:'Pretendard','Noto Sans KR','Apple SD Gothic Neo',Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.85;word-break:keep-all}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
.top{background:var(--green);color:#fff}.top .wrap{min-height:56px;display:flex;align-items:center;justify-content:space-between}
.brand{font-weight:900;color:#fff;text-decoration:none;letter-spacing:-.02em}.top .cta{font-size:13px;color:#eafff1;text-decoration:none}
.page{padding:24px 0 70px}.crumb{font-size:13px;color:var(--muted);margin-bottom:14px}.crumb a{color:var(--muted);text-decoration:none}
.article{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 16px 46px rgba(18,50,74,.08)}
.head{padding:38px 42px 28px;background:linear-gradient(150deg,#fff 62%,var(--teal-soft));border-bottom:1px solid var(--line)}
.badge{display:inline-block;background:var(--teal-soft);color:#155059;border:1px solid #bfe0dd;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:900}
h1{font-size:clamp(25px,3.9vw,36px);line-height:1.34;letter-spacing:-.03em;margin:15px 0 15px;color:var(--navy)}
.lead{background:var(--navy);color:#fff;border-left:5px solid var(--gold);padding:17px 19px;border-radius:10px;font-size:16.5px;font-weight:700}
.byline{margin-top:15px;color:var(--muted);font-size:13px;display:flex;flex-wrap:wrap;gap:6px 15px}
.body{padding:34px 42px 42px}.body h2{font-size:22px;line-height:1.42;letter-spacing:-.02em;margin:42px 0 12px;color:var(--navy)}.body h2:first-of-type{margin-top:22px}
.body p{margin:0 0 16px;font-size:16.5px}.body strong{color:var(--navy);font-weight:900}
.summary{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:19px 21px;margin:22px 0}.summary b{display:block;color:var(--navy);margin-bottom:8px}.summary ul{margin:0;padding-left:20px}.summary li{margin:6px 0}
.body ul.list{margin:0 0 18px;padding-left:20px}.body ul.list li{margin:6px 0}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;margin:20px 0 24px;background:#fff}table{width:100%;border-collapse:collapse;min-width:520px}th,td{text-align:left;padding:13px 15px;border-bottom:1px solid var(--line);vertical-align:top;font-size:15px}thead th{background:var(--navy);color:#fff}tbody th{background:var(--soft);color:var(--navy);width:26%}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
.infographic{margin:26px 0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff}.infographic-h{background:var(--teal);color:#fff;padding:14px 20px;font-weight:900;font-size:15px}.ig-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}.ig-item{background:#fff;padding:18px;display:flex;gap:12px;align-items:flex-start}.ig-ic{flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--teal-soft);border:1px solid #bfe0dd;display:flex;align-items:center;justify-content:center;color:#155059}.ig-item b{display:block;color:var(--navy);font-size:15px;margin-bottom:3px}.ig-item .t{font-size:13.5px;color:#4b5b62;line-height:1.6}
.figure-note{color:var(--muted);font-size:12.5px;margin:-14px 0 24px;text-align:center}
.callout,.warn{border-radius:12px;padding:18px 20px;margin:24px 0}.callout{background:var(--teal-soft);border:1px solid #bfe0dd}.warn{background:#fff3f2;border:1px solid #f2cdc9}.callout .label,.warn .label{display:inline-block;font-size:12px;font-weight:900;color:#8a6a12;margin-bottom:6px}
.help{margin:28px 0;padding:19px 21px;border:1px dashed #bfe0dd;border-radius:12px;background:#fff}.help b{color:var(--navy)}
.faq{margin-top:14px}.faq details{border-top:1px solid var(--line);padding:15px 2px}.faq details:last-child{border-bottom:1px solid var(--line)}.faq summary{cursor:pointer;font-weight:850;color:var(--navy)}.faq p{margin:9px 0 2px;color:#475467}
.related{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:26px 0}.related b{display:block;color:var(--navy);margin-bottom:8px}.related a{display:block;color:var(--teal);font-weight:800;margin:5px 0;text-decoration:none}
.community{margin-top:30px;background:linear-gradient(135deg,var(--navy),#123f4a);color:#fff;padding:22px;border-radius:12px}.community b{font-size:16px}.community a{display:inline-block;margin-top:10px;color:#0f2b33;background:#eafff1;padding:9px 15px;border-radius:6px;text-decoration:none;font-weight:900;margin-right:8px}
.disclaimer{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.foot{padding:26px 0;color:var(--muted);font-size:13px}
.board{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 16px 46px rgba(18,50,74,.08)}
.board-h{padding:30px 34px;background:linear-gradient(150deg,#fff 62%,var(--teal-soft));border-bottom:1px solid var(--line)}
.board-h h1{margin:6px 0 6px}.board-h p{margin:0;color:var(--muted);font-size:15px}
.board-list{list-style:none;margin:0;padding:0}.board-list li{border-bottom:1px solid var(--line)}.board-list li:last-child{border-bottom:0}
.board-list a{display:block;padding:20px 34px;text-decoration:none;color:var(--ink)}.board-list a:hover{background:var(--soft)}
.board-cat{font-size:12px;font-weight:900;color:#155059}.board-title{display:block;font-size:18px;font-weight:800;color:var(--navy);margin:5px 0 6px;letter-spacing:-.02em}.board-desc{font-size:14px;color:var(--muted)}.board-date{font-size:12px;color:#9aa7ac;margin-top:6px}
@media(max-width:720px){.head{padding:30px 18px 24px}.body{padding:26px 18px 36px}.body p{font-size:16px}.body h2{font-size:20px;margin:36px 0 10px}.ig-grid{grid-template-columns:1fr}table{min-width:0}tbody th{width:38%}.board-h,.board-list a{padding-left:18px;padding-right:18px}}`;

function renderBlocks(body) {
  const out = [];
  for (const b of body) {
    if (typeof b === 'string') { out.push(`<p>${mdBold(b)}</p>`); continue; }
    if (b.type === 'heading') { out.push(`<h2>${esc(b.text)}</h2>`); continue; }
    if (b.type === 'summary') {
      out.push(`<div class="summary"><b>${esc(b.title || '핵심 요약')}</b><ul>${(b.items || []).map((i) => `<li>${mdBold(i)}</li>`).join('')}</ul></div>`);
      continue;
    }
    if (b.type === 'list') {
      out.push(`<ul class="list">${(b.items || []).map((i) => `<li>${mdBold(i)}</li>`).join('')}</ul>`);
      continue;
    }
    if (b.type === 'table') {
      const head = `<thead><tr>${(b.headers || []).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
      const rows = (b.rows || []).map((r) => `<tr>${r.map((c, i) => i === 0 ? `<th>${mdBold(c)}</th>` : `<td>${mdBold(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table>${head}<tbody>${rows}</tbody></table></div>`);
      continue;
    }
    if (b.type === 'infographic') {
      const items = (b.items || []).map((it) => `<div class="ig-item"><span class="ig-ic">${it.icon || ''}</span><div><b>${esc(it.title)}</b><span class="t">${esc(it.text)}</span></div></div>`).join('');
      out.push(`<div class="infographic"><div class="infographic-h">${esc(b.title)}</div><div class="ig-grid">${items}</div></div>`);
      if (b.caption) out.push(`<p class="figure-note">▲ ${esc(b.caption)}</p>`);
      continue;
    }
    if (b.type === 'callout') { out.push(`<div class="callout"><span class="label">${esc(b.label || '팁')}</span><p>${mdBold(b.text)}</p></div>`); continue; }
    if (b.type === 'warning') { out.push(`<div class="warn"><span class="label">${esc(b.label || '주의')}</span><p>${mdBold(b.text)}</p></div>`); continue; }
    if (b.type === 'help') { out.push(`<div class="help"><b>${esc(b.title || '이 글이 도움이 되셨다면')}</b><br>${mdBold(b.text)}</div>`); continue; }
  }
  return out.join('\n');
}

function articleHtml(c, related) {
  const url = `${site}/column/${c.slug}/`;
  const faqHtml = (c.faqs || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const relatedHtml = related.length
    ? `<div class="related"><b>함께 보면 좋은 글</b>${related.map((r) => `<a href="${esc(r.href)}">${esc(r.label)} →</a>`).join('')}</div>`
    : '';
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', '@id': `${url}#article`, headline: c.title, description: c.description,
        author: { '@type': 'Organization', name: brand, url: site },
        publisher: { '@type': 'Organization', name: brand, url: site },
        datePublished: c.datePublished, dateModified: c.dateModified || c.datePublished,
        mainEntityOfPage: url, about: c.keywords || [], inLanguage: 'ko-KR',
      },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '본초죽염 건강 칼럼', item: `${site}/column/` },
        { '@type': 'ListItem', position: 2, name: c.title, item: url },
      ] },
      ...((c.faqs || []).length ? [{ '@type': 'FAQPage', mainEntity: c.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
    ],
  };
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)} | ${brand}</title>
<meta name="description" content="${esc(c.description)}">
<meta name="author" content="${brand}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="${brand} 건강 칼럼">
<meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(c.title)}"><meta name="twitter:description" content="${esc(c.description)}">
<style>${STYLE}</style>
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head><body>
<header class="top"><div class="wrap"><a class="brand" href="/">${brand} · 건강 칼럼</a><a class="cta" href="/column/">칼럼 전체보기 →</a></div></header>
<main class="page"><div class="wrap">
<nav class="crumb"><a href="/">홈</a> &gt; <a href="/column/">건강 칼럼</a> &gt; ${esc(c.category)}</nav>
<article class="article">
<header class="head"><span class="badge">${esc(c.category)}</span><h1>${esc(c.title)}</h1><p class="lead">${mdBold(c.lead)}</p>
<div class="byline"><span>${brand}</span><span>정보 칼럼</span><span>${esc(c.datePublished)}</span></div></header>
<section class="body">
${renderBlocks(c.body)}
${relatedHtml}
${(c.faqs || []).length ? `<h2>자주 묻는 질문</h2><div class="faq">${faqHtml}</div>` : ''}
<div class="community"><b>죽염 사용 후기와 궁금한 점, 함께 나눠요</b><br>실제 사용 후기와 질문은 아래 커뮤니티에서 확인하실 수 있습니다.<br><a href="${cafeUrl}" target="_blank" rel="noopener">네이버 카페 후기·문의 →</a><a href="${productGo}" target="_blank" rel="noopener">제품 보기 →</a></div>
<p class="disclaimer">이 글은 일반적인 생활·건강 정보 제공을 위한 것으로, 의학적 진단·치료나 특정 효과를 보장하는 내용이 아닙니다. ${brand}을 비롯한 소금은 식품이며, 건강 상태나 증상에 대한 판단·치료는 의료 전문가와 상담하시기 바랍니다.</p>
</section></article>
</div></main>
<footer class="foot"><div class="wrap">© ${brand} · 건강 칼럼 · 홈페이지 제작 <a href="https://aubcompany.com/" rel="noopener">아비컴퍼니</a></div></footer>
</body></html>`;
}

function boardHtml(cols) {
  const items = cols.map((c) => `<li><a href="/column/${c.slug}/"><span class="board-cat">${esc(c.category)}</span><span class="board-title">${esc(c.title)}</span><span class="board-desc">${esc(c.description)}</span><div class="board-date">${esc(c.datePublished)}</div></a></li>`).join('');
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>본초죽염 건강 칼럼 — 소금·죽염·생활 건강 정보 | ${brand}</title>
<meta name="description" content="소금과 죽염, 생활 건강에 대한 정보 칼럼을 모았습니다. 효능 과장 없이 근거와 올바른 사용법 중심으로 정리합니다.">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="${site}/column/">
<meta property="og:type" content="website"><meta property="og:title" content="본초죽염 건강 칼럼"><meta property="og:description" content="소금·죽염·생활 건강 정보 칼럼"><meta property="og:url" content="${site}/column/">
<style>${STYLE}</style>
</head><body>
<header class="top"><div class="wrap"><a class="brand" href="/">${brand} · 건강 칼럼</a><a class="cta" href="/">홈으로 →</a></div></header>
<main class="page"><div class="wrap">
<nav class="crumb"><a href="/">홈</a> &gt; 건강 칼럼</nav>
<div class="board">
<div class="board-h"><span class="badge">건강 칼럼</span><h1>소금·죽염·생활 건강 정보</h1><p>효능을 과장하지 않고, 근거와 올바른 사용법 중심으로 정리한 정보 칼럼입니다.</p></div>
<ul class="board-list">${items}</ul>
</div>
</div></main>
<footer class="foot"><div class="wrap">© ${brand} · 건강 칼럼 · 홈페이지 제작 <a href="https://aubcompany.com/" rel="noopener">아비컴퍼니</a></div></footer>
</body></html>`;
}

// ---- build ----
const cols = JSON.parse(readFileSync('content/columns.json', 'utf8'));
// 최신순 정렬(날짜 내림차순, 동일 날짜는 배열 뒤가 최신)
const ordered = cols.map((c, i) => ({ c, i })).sort((a, b) => (a.c.datePublished < b.c.datePublished ? 1 : a.c.datePublished > b.c.datePublished ? -1 : b.i - a.i)).map((x) => x.c);

let count = 0;
for (const c of cols) {
  const related = (c.related || []).filter((r) => cols.some((x) => `/column/${x.slug}/` === r.href.replace(/\/?$/, '/')));
  const dir = `column/${c.slug}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, articleHtml(c, related), 'utf8');
  count += 1;
}
if (!existsSync('column')) mkdirSync('column', { recursive: true });
writeFileSync('column/index.html', boardHtml(ordered), 'utf8');

// sitemap
const urls = [
  { loc: `${site}/`, pri: '1.0' },
  { loc: `${site}/column/`, pri: '0.8' },
  ...ordered.map((c) => ({ loc: `${site}/column/${c.slug}/`, pri: '0.7', lastmod: c.dateModified || c.datePublished })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`;
writeFileSync('sitemap.xml', sitemap, 'utf8');

// rss
const rssItems = ordered.slice(0, 30).map((c) => `    <item><title>${esc(c.title)}</title><link>${site}/column/${c.slug}/</link><description>${esc(c.description)}</description><pubDate>${new Date(c.datePublished + 'T09:00:00+09:00').toUTCString()}</pubDate><guid>${site}/column/${c.slug}/</guid></item>`).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n    <title>본초죽염 건강 칼럼</title>\n    <link>${site}/column/</link>\n    <description>소금·죽염·생활 건강 정보 칼럼</description>\n    <language>ko-KR</language>\n${rssItems}\n</channel></rss>\n`;
writeFileSync('rss.xml', rss, 'utf8');

// llms.txt (GEO/AI)
const llms = `# 본초죽염 (건강 칼럼)\n\n> 소금과 죽염, 생활 건강에 대한 정보를 효능 과장 없이 근거와 올바른 사용법 중심으로 정리한 칼럼입니다.\n\n## 개요\n- 운영: 본초죽염\n- 홈페이지: ${site}/\n- 칼럼 전체보기: ${site}/column/\n- 커뮤니티(후기·문의): ${cafeUrl}\n\n## 방침\n- 소금은 식품이며, 특정 질병의 치료·예방 효과를 표방하지 않습니다.\n- 생활 정보와 올바른 사용법, 죽염과 일반 소금의 차이 등을 다룹니다.\n\n## 칼럼 목록\n${ordered.map((c) => `- [${c.title}](${site}/column/${c.slug}/) — ${c.category}`).join('\n')}\n`;
writeFileSync('llms.txt', llms, 'utf8');

console.log(`Generated ${count} column pages + board + sitemap(${urls.length}) + rss + llms`);
