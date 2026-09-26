(() => {
  'use strict';
  const reviews = ['빠른 배송 감사합니다.', '귀한 소금~ 아주 좋아요.', '계속 구매해서 먹고있답니다 굿입니다'];
  try { if (sessionStorage.getItem('boncho-review-dismissed')) return; } catch (_) {}
  const card = document.createElement('aside');
  card.className = 'review-notice';
  card.hidden = true;
  card.setAttribute('aria-label', '구매후기');
  card.innerHTML = '<button class="review-notice-close" type="button" aria-label="구매후기 알림 닫기">×</button><span class="review-notice-label">네이버 구매후기 · 일부 발췌</span><p class="review-notice-quote"></p><a href="https://smartstore.naver.com/arbcompany/products/10424332477" target="_blank" rel="noopener noreferrer">상품과 원문 후기 보기 ↗</a>';
  document.body.append(card);
  let index = 0, highWaterMark = Math.max(0, window.scrollY), revealBaseline = highWaterMark;
  let visible = false, closed = false, autoTimer, hideTimer;
  const hide = () => {
    clearTimeout(autoTimer);
    card.classList.remove('is-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      card.hidden = true;
      visible = false;
      revealBaseline = highWaterMark;
    }, 300);
  };
  const onScroll = () => {
    if (closed) return;
    const y = Math.max(0, window.scrollY);
    if (y <= highWaterMark) return;
    highWaterMark = y;
    if (visible) { revealBaseline = highWaterMark; return; }
    if (highWaterMark - revealBaseline < Math.max(420, innerHeight * .65)) return;
    revealBaseline = highWaterMark;
    clearTimeout(autoTimer);
    clearTimeout(hideTimer);
    card.querySelector('p').textContent = '“' + reviews[index++ % reviews.length] + '”';
    card.hidden = false;
    visible = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!closed && visible) card.classList.add('is-visible'); }));
    autoTimer = setTimeout(hide, 6500);
  };
  card.querySelector('button').addEventListener('click', () => {
    closed = true;
    visible = false;
    clearTimeout(autoTimer);
    clearTimeout(hideTimer);
    card.classList.remove('is-visible');
    card.hidden = true;
    window.removeEventListener('scroll', onScroll);
    try { sessionStorage.setItem('boncho-review-dismissed', '1'); } catch (_) {}
  });
  card.addEventListener('focusin', () => clearTimeout(autoTimer));
  card.addEventListener('focusout', () => { if (!closed && visible) autoTimer = setTimeout(hide, 6500); });
  card.addEventListener('mouseenter', () => clearTimeout(autoTimer));
  card.addEventListener('mouseleave', () => { if (!closed && visible && !card.contains(document.activeElement)) autoTimer = setTimeout(hide, 6500); });
  window.addEventListener('scroll', onScroll, { passive: true });
})();
