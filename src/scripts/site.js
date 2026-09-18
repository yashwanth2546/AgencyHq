// Scroll choreography for the marketing page: nav ink inversion + sliding
// indicator pill, the pinned manifesto stepper, masked line reveals, and the
// cursor-trailing work thumbnail. No third-party runtime — IntersectionObserver
// plus a couple of passive scroll listeners, torn down on nothing since this
// script owns the page for its lifetime.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function on(target, ev, fn, opts) {
  target.addEventListener(ev, fn, opts);
}

// ---------------------------------------------------------------------------
// Reveal on enter — masked lines rise into place once, at 20% visibility.
// Markup ships visible (CSS starts it translated); JS just releases it.
// ---------------------------------------------------------------------------
function setReveals() {
  if (reduced) return;
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
      nav.style.background = dark ? 'rgba(255,255,255,.07)' : 'rgba(17,17,17,.05)';
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
// Pinned manifesto stepper — stacks instead of pinning under 900px or on
// reduced motion.
// ---------------------------------------------------------------------------
function setPin() {
  const wrap = document.querySelector('[data-pin]');
  if (!wrap) return;
  const inner = wrap.querySelector('[data-pin-inner]');
  const steps = Array.from(wrap.querySelectorAll('[data-step]'));
  const current = wrap.querySelector('[data-step-current]');
  const stepsWrap = wrap.querySelector('[data-steps]');
  if (!inner || !steps.length) return;

  // Absolute steps must resolve against their own column, not the sticky
  // wrapper, or they break out of the right-hand half.
  if (stepsWrap) stepsWrap.style.position = 'relative';
  let pinned = false;

  const stack = () => {
    pinned = false;
    wrap.style.height = '';
    inner.style.position = 'relative';
    inner.style.top = '';
    inner.style.minHeight = '';
    steps.forEach((s) => {
      s.style.position = 'relative';
      s.style.opacity = '1';
      s.style.width = '';
    });
    if (current) current.textContent = '01';
  };

  const pin = () => {
    pinned = true;
    wrap.style.height = steps.length * 100 + 'vh';
    inner.style.position = 'sticky';
    inner.style.top = '0';
    inner.style.minHeight = '100vh';
    steps.forEach((s, i) => {
      s.style.position = i === 0 ? 'relative' : 'absolute';
      if (i > 0) {
        s.style.top = '0';
        s.style.left = '0';
        s.style.width = '100%';
      }
      s.style.opacity = i === 0 ? '1' : '0';
      s.style.transition = 'opacity 400ms linear';
    });
  };

  const update = () => {
    if (!pinned) return;
    const r = wrap.getBoundingClientRect();
    const span = wrap.offsetHeight - window.innerHeight;
    const p = span > 0 ? Math.min(Math.max(-r.top / span, 0), 0.999) : 0;
    const idx = Math.min(Math.floor(p * steps.length), steps.length - 1);
    steps.forEach((s, i) => { s.style.opacity = i === idx ? '1' : '0'; });
    if (current) current.textContent = '0' + (idx + 1);
  };

  const decide = () => {
    const want = !reduced && window.innerWidth >= 900;
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
  if (reduced) {
    prev.style.display = 'none';
    return;
  }

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

function init() {
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
