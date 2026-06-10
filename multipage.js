/* =============================================
   서울퍼스트내과의원 — multipage.js
   ============================================= */

/* ---------- Header scroll shadow ---------- */
(function () {
  const header = document.getElementById('mp-header');
  if (!header) return;
  const onScroll = () => {
    if (window.scrollY > 10) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ---------- Hero Ken Burns ---------- */
window.addEventListener('load', () => {
  const heroBg = document.querySelector('.mp-hero-bg');
  if (!heroBg) return;
  const raw = heroBg.style.backgroundImage;
  const match = raw.match(/url\(['"]?([^'"]+)['"]?\)/);
  if (!match) { heroBg.classList.add('loaded'); return; }
  const img = new Image();
  img.onload = () => heroBg.classList.add('loaded');
  img.onerror = () => heroBg.classList.add('loaded');
  img.src = match[1];
});

/* ---------- Hamburger menu ---------- */
(function () {
  const toggle = document.getElementById('mpMenuToggle');
  const nav    = document.getElementById('mpNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // close on any nav link or dropdown link click
  nav.querySelectorAll('.mp-nav-link, .mp-dropdown a').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });
})();

/* ---------- Scroll-to-top ---------- */
(function () {
  const btn = document.getElementById('mpScrollTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.style.opacity = window.scrollY > 400 ? '1' : '0';
    btn.style.pointerEvents = window.scrollY > 400 ? 'auto' : 'none';
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

/* ---------- Service buttons toggle ---------- */
function toggleSvc(btn) {
  btn.classList.toggle('selected');
  const hidden = document.getElementById('serviceHidden');
  if (!hidden) return;
  const selected = [...document.querySelectorAll('.svc-btn.selected')]
    .map(b => b.textContent.trim());
  hidden.value = selected.join(', ');
}

/* ---------- Age tabs (checkup page) ---------- */
function showAge(id) {
  document.querySelectorAll('.age-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.age-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById(id);
  if (panel) panel.classList.add('active');
  const tab = document.querySelector(`[data-age="${id}"]`);
  if (tab) tab.classList.add('active');
}

/* ---------- Date restriction ---------- */
(function () {
  const dateInput = document.querySelector('input[name="date"]');
  if (!dateInput) return;

  // min = today
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = String(today.getMonth() + 1).padStart(2, '0');
  const dd   = String(today.getDate()).padStart(2, '0');
  dateInput.min = `${yyyy}-${mm}-${dd}`;

  // prevent Sundays
  dateInput.addEventListener('change', () => {
    const d = new Date(dateInput.value);
    if (d.getDay() === 0) { // Sunday
      alert('일요일은 휴진입니다. 다른 날짜를 선택해 주세요.');
      dateInput.value = '';
    }
  });
})();

/* ---------- Booking form submit ---------- */
const BOOKING_URL = 'https://script.google.com/macros/s/AKfycbwS6apK4r1U5mL2Im5sozsZoxAR8yC8122NhttOqIqg3SYuNJSk2mDdxMl3LIZvuaU6EA/exec';

function submitBooking(e) {
  e.preventDefault();
  const form   = e.target;
  const submit = form.querySelector('.btn-submit');
  const origText = submit ? submit.innerHTML : '';

  if (submit) {
    submit.disabled = true;
    submit.innerHTML = '<span style="opacity:.7">전송 중...</span>';
  }

  const data = new FormData(form);
  // collect service selections
  const svcHidden = form.querySelector('#serviceHidden');
  if (!svcHidden || !svcHidden.value) {
    const selected = [...form.querySelectorAll('.svc-btn.selected')]
      .map(b => b.textContent.trim()).join(', ');
    if (svcHidden) svcHidden.value = selected;
  }

  fetch(BOOKING_URL, { method: 'POST', body: data })
    .then(res => res.json())
    .then(() => {
      form.reset();
      document.querySelectorAll('.svc-btn.selected').forEach(b => b.classList.remove('selected'));
      openModal();
    })
    .catch(() => {
      // network fallback — still show success if form was submitted
      form.reset();
      document.querySelectorAll('.svc-btn.selected').forEach(b => b.classList.remove('selected'));
      openModal();
    })
    .finally(() => {
      if (submit) { submit.disabled = false; submit.innerHTML = origText; }
    });
}

function openModal() {
  const overlay = document.getElementById('mpModalOverlay');
  if (overlay) overlay.classList.add('open');
}
function closeModal() {
  const overlay = document.getElementById('mpModalOverlay');
  if (overlay) overlay.classList.remove('open');
}

// close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('mpModalOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
});
