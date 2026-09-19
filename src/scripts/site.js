// Scroll choreography for the marketing page: the page-frame ring, the
// capsule load-in, nav ink inversion + sliding indicator pill, the pinned
// manifesto stepper, masked line reveals, and the cursor-trailing work
// thumbnail. No third-party runtime — IntersectionObserver plus a handful
// of scroll/wheel/touch/key listeners, owned for the page's lifetime.
//
// Motion decision (2026-09-19): production forces motion regardless of
// prefers-reduced-motion, matching the shaders' own force-motion attribute.
// Nothing here reads matchMedia('(prefers-reduced-motion: reduce)').

function on(target, ev, fn, opts) {
  target.addEventListener(ev, fn, opts);
}

// ---------------------------------------------------------------------------
// Reveal on enter — masked lines rise into place once, at 20% visibility.
// Markup ships visible (CSS starts it translated); JS just releases it.
// ---------------------------------------------------------------------------
function setReveals() {
  const groups = Array.from(document.querySelectorAll('[data-reveal]'));
  if (!groups.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio < 0.2) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    },
    { threshold: [0, 0.2, 1] }
  );
  groups.forEach((g) => io.observe(g));

  // Safety net: never leave copy hidden if something goes wrong.
  setTimeout(() => groups.forEach((g) => g.classList.add('is-visible')), 6000);
}

// ---------------------------------------------------------------------------
// Page frame — a fixed, viewport-relative ring (box-shadow spread), not
// wrapper padding. Padding only paints grey where the document itself ends,
// thousands of px below the fold, so the bottom edge is never on screen;
// shrinking other sections to compensate just slides content into the gap.
//
// The fill is triggered by scroll INTENT, not scroll position. At the top,
// the first wheel notch / swipe / page-down is swallowed — preventDefault,
// the page does not move — and the frame closes in one 760ms move. Scrolling
// is released once it lands. The first upward intent while back at the top
// reopens it the same way. A busy flag guards the duration so a fast gesture
// can't re-trigger mid-move. A plain scroll listener is kept as a backstop:
// anything that moves the page by other means (anchor link, restored scroll
// position, momentum) closes the frame so it is never left open over
// scrolled content.
// ---------------------------------------------------------------------------
function setFrame() {
  const ring = document.querySelector('[data-frame]');
  const main = document.querySelector('#main');
  if (!ring || !main) return;

  const REST = 10, REST_R = 18, SHUT = 0, SHUT_R = 0;
  const EASE = 'cubic-bezier(0.22,1,0.36,1)';
  const DURATION = 760;

  let state = window.scrollY > 4 ? 'closed' : 'open';
  let busy = false;

  const write = (fr, r, animate) => {
    const t = animate ? (DURATION + 'ms ' + EASE) : 'none';
    ring.style.transition = animate ? ('inset ' + t + ', border-radius ' + t) : 'none';
    ring.style.inset = fr + 'px';
    ring.style.borderRadius = r + 'px';
    main.style.transition = animate ? ('border-radius ' + t) : 'none';
    main.style.borderRadius = r + 'px';
  };

  write(state === 'open' ? REST : SHUT, state === 'open' ? REST_R : SHUT_R, false);

  const closeFrame = () => {
    if (busy || state === 'closed') return;
    busy = true; state = 'closed';
    write(SHUT, SHUT_R, true);
    setTimeout(() => { busy = false; }, DURATION + 40);
  };
  const openFrame = () => {
    if (busy || state === 'open') return;
    busy = true; state = 'open';
    write(REST, REST_R, true);
    setTimeout(() => { busy = false; }, DURATION + 40);
  };
  const snapClosed = () => {
    if (state === 'closed') return;
    state = 'closed';
    write(SHUT, SHUT_R, false);
  };

  const atTop = () => window.scrollY <= 0;
  const swallow = (e) => { if (e.cancelable) e.preventDefault(); };

  const onWheel = (e) => {
    if (!atTop()) return;
    if (busy) { swallow(e); return; }
    if (e.deltaY > 0 && state === 'open') { swallow(e); closeFrame(); return; }
    if (e.deltaY < 0 && state === 'closed') { swallow(e); openFrame(); }
  };

  let touchStartY = 0;
  const onTouchStart = (e) => { touchStartY = e.touches[0].clientY; };
  const onTouchMove = (e) => {
    if (!atTop()) return;
    if (busy) { swallow(e); return; }
    const dy = touchStartY - e.touches[0].clientY; // >0: swiping up = scroll-down intent
    if (dy > 4 && state === 'open') { swallow(e); closeFrame(); return; }
    if (dy < -4 && state === 'closed') { swallow(e); openFrame(); }
  };

  const DOWN_KEYS = ['ArrowDown', 'PageDown', ' ', 'Spacebar', 'End'];
  const UP_KEYS = ['ArrowUp', 'PageUp', 'Home'];
  const onKeydown = (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(tag)) return;
    if (!atTop()) return;
    const isDown = DOWN_KEYS.includes(e.key);
    const isUp = UP_KEYS.includes(e.key);
    if (!isDown && !isUp) return;
    if (busy) { swallow(e); return; }
    if (isDown && state === 'open') { swallow(e); closeFrame(); return; }
    if (isUp && state === 'closed') { swallow(e); openFrame(); }
  };

  const onScroll = () => {
    if (!atTop() && state === 'open' && !busy) snapClosed();
  };

  on(window, 'wheel', onWheel, { passive: false });
  on(window, 'touchstart', onTouchStart, { passive: true });
  on(window, 'touchmove', onTouchMove, { passive: false });
  on(window, 'keydown', onKeydown);
  on(window, 'scroll', onScroll, { passive: true });
}

// ---------------------------------------------------------------------------
// Capsule load-in — <main> opens from a centred 232x60 pill to full bleed,
// clip-path only (never resize: layout underneath is final from the first
// frame). Centred in the VIEWPORT, converted into main's coordinate space
// via its own top offset, since main is the whole thousands-of-px document
// and centring in its own box would put the pill far below the fold. The
// header sits outside <main> so the clip never touches it — it fades in at
// ~55% through instead, or it would be the only thing on screen while the
// page is still closed. Skipped if the page loads already scrolled.
//
// Backgrounded-tab notes: a hidden tab never runs requestAnimationFrame, so
// (a) anything that must land exactly once is guarded by a synchronous
// timeout/visibilitychange path, never bare rAF, and (b) the queued rAFs
// below can still fire once the tab returns — the play() guard stops them
// from re-applying the clip to a page that has already finished.
// ---------------------------------------------------------------------------
function setIntro() {
  const main = document.querySelector('#main');
  const header = document.querySelector('.site-header');
  if (!main || !header || window.scrollY > 4) return;

  const DURATION = 1250;
  const EASE = 'cubic-bezier(0.16,1,0.3,1)';
  const W = 232, H = 60, R = 999;

  const mr = main.getBoundingClientRect();
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 - mr.top;
  const top = cy - H / 2;
  const left = cx - W / 2;
  const right = mr.width - (cx + W / 2);
  const bottom = mr.height - (cy + H / 2);

  const startClip = 'inset(' + top + 'px ' + right + 'px ' + bottom + 'px ' + left + 'px round ' + R + 'px)';
  const endClip = 'inset(0px 0px 0px 0px round 18px)';

  main.style.transition = 'none';
  main.style.clipPath = startClip;
  header.style.transition = 'none';
  header.style.opacity = '0';

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    main.style.transition = '';
    main.style.clipPath = '';
    header.style.transition = '';
    header.style.opacity = '';
  };

  const play = () => {
    if (done) return;
    main.style.transition = 'clip-path ' + DURATION + 'ms ' + EASE;
    main.style.clipPath = endClip;
    header.style.transition = 'opacity ' + Math.round(DURATION * 0.45) + 'ms linear';
    header.style.transitionDelay = Math.round(DURATION * 0.55) + 'ms';
    header.style.opacity = '1';
  };

  requestAnimationFrame(() => requestAnimationFrame(() => { if (!document.hidden) play(); }));

  const timer = setTimeout(finish, DURATION + 200);
  const onVis = () => { if (document.hidden) { clearTimeout(timer); finish(); } };
  on(document, 'visibilitychange', onVis);
  if (document.hidden) onVis();
}

// ---------------------------------------------------------------------------
// Nav — ink inverts off the ground behind the bar (not scroll depth), and the
// sliding pill tracks the active section (not the click).
// ---------------------------------------------------------------------------
function setNav() {
  const logo = document.querySelector('[data-logo]');
  const nav = document.querySelector('[data-nav]');
  const pill = document.querySelector('[data-nav-pill]');
  const cta = document.querySelector('[data-nav-cta]');
  const links = Array.from(document.querySelectorAll('[data-nav-link]'));
  const darks = Array.from(document.querySelectorAll('[data-ground="dark"]'));

  let onDark = null;
  let hovering = false;
  let active = -1;

  const tint = () => {
    const r = nav ? nav.getBoundingClientRect() : { top: 24, bottom: 72 };
    const line = (r.top + r.bottom) / 2;
    const dark = darks.some((s) => {
      const b = s.getBoundingClientRect();
      return b.top <= line && b.bottom >= line;
    });
    if (dark === onDark) return;
    onDark = dark;
    const ink = dark ? '255,255,255' : '17,17,17';
    if (logo) {
      logo.style.background = dark ? 'transparent' : 'rgba(17,17,17,.06)';
      logo.style.color = dark ? '#FFFFFF' : '#111111';
    }
    if (nav) {
      nav.style.setProperty('--nv-ink', ink);
      nav.style.setProperty('--nv-pill', ink);
      nav.style.borderColor = dark ? 'rgba(255,255,255,.15)' : 'rgba(17,17,17,.1)';
    }
    if (cta) cta.classList.toggle('gl--ink', !dark);
  };

  if (!pill || !links.length) {
    tint();
    on(window, 'scroll', tint, { passive: true });
    return;
  }

  const moveTo = (i, soft) => {
    const el = links[i];
    if (!el) {
      pill.style.opacity = '0';
      return;
    }
    pill.style.opacity = soft ? '.55' : '1';
    pill.style.width = el.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + el.offsetLeft + 'px)';
    links.forEach((l, n) => {
      l.style.color = n === i ? 'rgba(var(--nv-ink),1)' : 'rgba(var(--nv-ink),.7)';
    });
  };

  // Active section = the last one whose top has passed a line 140px down the
  // viewport. Before layout resolves, every section measures top ~0, which
  // would read as "all passed" and park the pill on the last link — so a
  // measurement where the sections are still stacked at 0 is discarded.
  const sync = () => {
    const line = 140;
    const tops = links.map((l) => {
      const sec = document.querySelector(l.getAttribute('href'));
      return sec ? sec.getBoundingClientRect().top : null;
    });
    if (tops.some((t) => t === null)) return;
    const settled = tops.some((t, i) => i === 0 || Math.abs(t - tops[0]) > 1);
    if (!settled) return;
    let next = -1;
    tops.forEach((t, i) => {
      if (t <= line) next = i;
    });
    if (next !== active) {
      active = next;
      if (!hovering) moveTo(active);
    }
  };

  links.forEach((l, i) => {
    on(l, 'pointerenter', () => {
      hovering = true;
      moveTo(i, i !== active);
    });
  });
  if (nav) on(nav, 'pointerleave', () => { hovering = false; moveTo(active); });

  const apply = () => { tint(); sync(); };
  apply();
  [0, 60, 250, 800].forEach((ms) => setTimeout(sync, ms));
  on(window, 'load', sync);
  on(window, 'scroll', apply, { passive: true });
  on(window, 'resize', () => moveTo(active), { passive: true });
}

// ---------------------------------------------------------------------------
// Pinned manifesto stepper. Driven by one progress value `p` (0..1) across
// the pin:
//  - the counter and the progress rule advance with p directly.
//  - statements advance directionally, not as a crossfade: the outgoing line
//    leaves toward the direction of travel, the incoming one rises in from
//    the opposite side.
//  - within the active statement, words fill 28%→100% white one at a time
//    across that statement's slice of p (local = clamp(p*n - idx, 0, 1)),
//    scaled to complete at local = 0.82 so the last word holds white for a
//    beat. Passed statements stay fully lit, upcoming ones stay dim, so
//    scrolling back up unwinds cleanly.
// Stacks instead of pinning under 900px, with every word lit and the rule
// at 100%.
// ---------------------------------------------------------------------------
function setPin() {
  const wrap = document.querySelector('[data-pin]');
  if (!wrap) return;
  const inner = wrap.querySelector('[data-pin-inner]');
  const steps = Array.from(wrap.querySelectorAll('[data-step]'));
  const current = wrap.querySelector('[data-step-current]');
  const stepsWrap = wrap.querySelector('[data-steps]');
  const rule = wrap.querySelector('[data-progress-rule]');
  if (!inner || !steps.length) return;

  // Split each statement's inner span into word spans once, in JS, keeping
  // the trailing space inside each span so wrapping matches the unsplit
  // text exactly. Guarded so re-running setup never re-splits.
  const words = steps.map((s) => {
    const host = s.querySelector('span') || s;
    if (host.dataset.split) return Array.from(host.querySelectorAll('.step-word'));
    const text = host.textContent;
    host.dataset.split = '1';
    host.textContent = '';
    const parts = text.match(/\S+\s*/g) || [text];
    return parts.map((part) => {
      const span = document.createElement('span');
      span.className = 'step-word';
      span.textContent = part;
      host.appendChild(span);
      return span;
    });
  });

  if (stepsWrap) stepsWrap.style.position = 'relative';

  let pinned = false;
  let idx = 0;

  const lit = (i) => { words[i].forEach((w) => { w.style.color = ''; }); };
  const dim = (i) => { words[i].forEach((w) => { w.style.color = 'rgba(255,255,255,.28)'; }); };
  const fill = (i, local) => {
    const list = words[i];
    const scaled = Math.min(local / 0.82, 1);
    list.forEach((w, wi) => {
      const wp = Math.min(Math.max(scaled * list.length - wi, 0), 1);
      w.style.color = 'rgba(255,255,255,' + (0.28 + wp * 0.72).toFixed(3) + ')';
    });
  };

  const stack = () => {
    pinned = false;
    wrap.style.height = '';
    inner.style.position = 'relative';
    inner.style.top = '';
    inner.style.minHeight = '';
    steps.forEach((s, i) => {
      s.style.position = 'relative';
      s.style.opacity = '1';
      s.style.transform = 'none';
      s.style.transition = 'none';
      s.style.width = '';
      lit(i);
    });
    if (current) current.textContent = '01';
    if (rule) rule.style.width = '100%';
  };

  const pin = () => {
    pinned = true;
    idx = -1; // forces the first update() to run step 0's entry transition
    wrap.style.height = steps.length * 100 + 'vh';
    inner.style.position = 'sticky';
    inner.style.top = '0';
    inner.style.minHeight = '100vh';
    steps.forEach((s, i) => {
      s.style.position = i === 0 ? 'relative' : 'absolute';
      if (i > 0) { s.style.top = '0'; s.style.left = '0'; s.style.width = '100%'; }
      s.style.transition = 'none';
      s.style.opacity = '0';
      s.style.transform = 'translateY(38px)';
      dim(i);
    });
  };

  const enter = (i, from) => {
    const s = steps[i];
    s.style.transition = 'none';
    s.style.opacity = '0';
    s.style.transform = 'translateY(' + from + 'px)';
    void s.offsetWidth; // flush so the next write transitions
    s.style.transition = 'opacity 520ms cubic-bezier(0.22,1,0.36,1), transform 640ms cubic-bezier(0.22,1,0.36,1)';
    s.style.opacity = '1';
    s.style.transform = 'translateY(0)';
  };
  const leave = (i, to) => {
    const s = steps[i];
    s.style.transition = 'opacity 520ms cubic-bezier(0.22,1,0.36,1), transform 640ms cubic-bezier(0.22,1,0.36,1)';
    s.style.opacity = '0';
    s.style.transform = 'translateY(' + to + 'px)';
  };

  const update = () => {
    if (!pinned) return;
    const r = wrap.getBoundingClientRect();
    const span = wrap.offsetHeight - window.innerHeight;
    const p = span > 0 ? Math.min(Math.max(-r.top / span, 0), 0.999) : 0;
    const nextIdx = Math.min(Math.floor(p * steps.length), steps.length - 1);

    if (nextIdx !== idx) {
      const dir = nextIdx > idx ? 1 : -1; // 1 = advancing, -1 = reversing
      if (idx >= 0) leave(idx, dir > 0 ? -38 : 38);
      enter(nextIdx, dir > 0 ? 38 : -38);
      idx = nextIdx;
      if (current) current.textContent = '0' + (idx + 1);
    }

    steps.forEach((s, i) => {
      const local = Math.min(Math.max(p * steps.length - i, 0), 1);
      if (i === idx) fill(i, local);
      else if (local >= 1) lit(i);
      else dim(i);
    });
    if (rule) rule.style.width = (p * 100).toFixed(2) + '%';
  };

  const decide = () => {
    const want = window.innerWidth >= 900;
    if (want && !pinned) pin();
    if (!want && pinned) stack();
    update();
  };

  decide();
  on(window, 'scroll', update, { passive: true });
  on(window, 'resize', decide);
}

// ---------------------------------------------------------------------------
// Work-row thumbnail trailing the cursor with lag. Pointer-capable only — on
// touch the loop and listeners are never attached.
// ---------------------------------------------------------------------------
function setWorkPreview() {
  const prev = document.querySelector('[data-work-preview]');
  const rows = Array.from(document.querySelectorAll('[data-work-row]'));
  if (!prev || !rows.length) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  let tx = 0, ty = 0, x = 0, y = 0, active = false, raf = null;

  const move = (e) => { tx = e.clientX + 26; ty = e.clientY - 100; };
  const loop = () => {
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    prev.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    raf = requestAnimationFrame(loop);
  };
  const start = (e) => {
    if (active) return;
    active = true;
    tx = x = e.clientX + 26;
    ty = y = e.clientY - 100;
    prev.style.opacity = '1';
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    active = false;
    prev.style.opacity = '0';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  };

  rows.forEach((r) => {
    on(r, 'pointerenter', start);
    on(r, 'pointerleave', stop);
    on(r, 'pointermove', move);
  });
}

// ---------------------------------------------------------------------------
// Hero entrance — two statement lines + subline rise out of their clip
// wrappers, then the meta rail fades in. Markup ships visible; JS hides it,
// so a script failure leaves a readable hero. Released at 820ms to land after
// the capsule load-in has opened. Skipped under prefers-reduced-motion (the
// one place this page honours it — the hero brief asks for it explicitly).
// ---------------------------------------------------------------------------
function setHeroEntrance() {
  const items = Array.from(document.querySelectorAll('[data-hero-enter]'));
  const meta = document.querySelector('[data-hero-meta]');
  if (!items.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  items.forEach((el) => {
    el.style.transform = 'translateY(115%)';
    el.style.opacity = '0';
    el.style.willChange = 'transform, opacity';
  });
  if (meta) meta.style.opacity = '0';

  setTimeout(() => {
    items.forEach((el, i) => {
      const d = i * 110;
      el.style.transition = 'transform 1000ms cubic-bezier(0.16,1,0.3,1) ' + d + 'ms, opacity 700ms linear ' + d + 'ms';
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    });
    if (meta) {
      meta.style.transition = 'opacity 700ms linear 1450ms';
      meta.style.opacity = '1';
    }
  }, 820);
}

function init() {
  setFrame();
  setIntro();
  setHeroEntrance();
  setReveals();
  setNav();
  setPin();
  setWorkPreview();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
