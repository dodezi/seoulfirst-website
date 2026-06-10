// ===================== MOBILE NAV =====================
const menuToggle = document.getElementById('menuToggle');
const nav = document.getElementById('nav');

menuToggle.addEventListener('click', () => {
  nav.classList.toggle('open');
  menuToggle.classList.toggle('open');
});

// Close nav when link is clicked
nav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
  });
});

// ===================== STICKY HEADER =====================
const header = document.getElementById('header');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const currentScroll = window.scrollY;
  if (currentScroll > 80) {
    header.style.transform = currentScroll > lastScroll && currentScroll > 200
      ? 'translateY(-100%)'
      : 'translateY(0)';
    header.style.transition = 'transform 0.3s ease';
  } else {
    header.style.transform = 'translateY(0)';
  }
  lastScroll = currentScroll;

  // Show/hide scroll-to-top button
  const scrollTop = document.getElementById('scrollTop');
  scrollTop.style.opacity = currentScroll > 400 ? '1' : '0';
  scrollTop.style.pointerEvents = currentScroll > 400 ? 'auto' : 'none';
});

// ===================== ACTIVE NAV LINK =====================
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + entry.target.id) {
          link.classList.add('active');
        }
      });
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(s => observer.observe(s));

// ===================== BOOKING FORM =====================
// 구글 Apps Script 배포 후 아래 URL을 교체하세요
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwS6apK4r1U5mL2Im5sozsZoxAR8yC8122NhttOqIqg3SYuNJSk2mDdxMl3LIZvuaU6EA/exec';

function submitBooking(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);

  const name = data.get('name').trim();
  const phone = data.get('phone').trim();
  const service = data.get('service');
  const date = data.get('date');

  if (!name || !phone || !service || !date) {
    alert('필수 항목을 모두 입력해 주세요.');
    return;
  }

  const phoneRegex = /^01[0-9]-?\d{3,4}-?\d{4}$/;
  if (!phoneRegex.test(phone.replace(/-/g, ''))) {
    alert('올바른 연락처를 입력해 주세요. (예: 010-1234-5678)');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = '처리 중...';
  submitBtn.disabled = true;

  const payload = {
    name,
    phone,
    date,
    time: data.get('time') || '',
    service,
    memo: data.get('memo') || ''
  };

  fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(() => {
      form.reset();
      document.querySelectorAll('.svc-btn.active').forEach(b => b.classList.remove('active'));
      document.getElementById('serviceHidden').value = '';
      submitBtn.textContent = '예약 신청하기';
      submitBtn.disabled = false;
      document.getElementById('modalOverlay').style.display = 'flex';
    })
    .catch(() => {
      alert('전송 중 오류가 발생했습니다. 전화(031-515-1500)로 예약해 주세요.');
      submitBtn.textContent = '예약 신청하기';
      submitBtn.disabled = false;
    });
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// Close modal on overlay click
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ===================== DATE RESTRICTION =====================
// Prevent selecting past dates and Sundays
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.querySelector('input[type="date"]');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
    dateInput.addEventListener('change', function() {
      const selected = new Date(this.value);
      const day = selected.getDay(); // 0=Sun
      if (day === 0) {
        alert('일요일은 휴진입니다. 다른 날짜를 선택해 주세요.');
        this.value = '';
      }
    });
  }

  // Auto-format phone number
  const phoneInput = document.querySelector('input[type="tel"]');
  if (phoneInput) {
    phoneInput.addEventListener('input', function() {
      let v = this.value.replace(/\D/g, '');
      if (v.length >= 7) {
        v = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
      } else if (v.length >= 4) {
        v = v.slice(0,3) + '-' + v.slice(3);
      }
      this.value = v;
    });
  }
});

// ===================== 블로그 RSS 자동 로딩 =====================
async function loadBlogPosts() {
  const grid = document.getElementById('blogGrid');
  const fallback = document.getElementById('blogFallback');
  if (!grid) return;

  const RSS_URL = 'https://rss.blog.naver.com/dodezi.xml';
  const API_URL = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(RSS_URL)}&count=3`;

  // 5초 타임아웃
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    if (data.status !== 'ok' || !data.items || data.items.length === 0) {
      throw new Error('No posts');
    }

    grid.innerHTML = data.items.slice(0, 3).map(post => {
      const imgSrc = post.thumbnail || null;
      const cleanDesc = post.description
        ? post.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 90) + '...'
        : '이동원 원장의 건강 블로그에서 자세한 내용을 확인하세요.';
      const date = post.pubDate
        ? new Date(post.pubDate).toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'})
        : '';

      return `
        <article class="blog-card">
          <a href="${post.link}" target="_blank" rel="noopener" class="blog-card-link">
            ${imgSrc
              ? `<div class="blog-img-real"><img src="${imgSrc}" alt="${post.title}" loading="lazy" /></div>`
              : `<div class="blog-img-placeholder"><div>📝</div></div>`}
          </a>
          <div class="blog-body">
            <span class="blog-tag">건강정보</span>
            <h4><a href="${post.link}" target="_blank" rel="noopener">${post.title}</a></h4>
            <p>${cleanDesc}</p>
            <div class="blog-meta">
              ${date ? `<span class="blog-date">${date}</span>` : ''}
              <a href="${post.link}" target="_blank" rel="noopener" class="blog-more">블로그에서 보기 →</a>
            </div>
          </div>
        </article>`;
    }).join('');

    // 성공 시: 그리드 보이고 폴백 숨김
    grid.style.display = 'grid';
    fallback.style.display = 'none';

  } catch (e) {
    clearTimeout(timer);
    // 실패 시: 폴백 유지 (이미 기본으로 보임)
  }
}

document.addEventListener('DOMContentLoaded', loadBlogPosts);

// ===================== 서비스 버튼 토글 =====================
function toggleSvc(btn) {
  btn.classList.toggle('active');
  const selected = Array.from(document.querySelectorAll('.svc-btn.active')).map(b => b.textContent.trim());
  document.getElementById('serviceHidden').value = selected.join(', ');
}

// ===================== AGE TAB =====================
function showAge(id) {
  document.querySelectorAll('.age-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.age-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const idx = ['age20','age40','age60'].indexOf(id);
  document.querySelectorAll('.age-tab')[idx].classList.add('active');
}

// ===================== SCROLL ANIMATIONS =====================
const animObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      animObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.about-card, .service-card, .service-item, .facility-card, .blog-card, .stat').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  animObserver.observe(el);
});

// Staggered animations
document.querySelectorAll('.about-card, .service-item, .blog-card').forEach((el, i) => {
  el.style.transitionDelay = (i % 4) * 0.1 + 's';
});

// Add visible class trigger
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = '.visible { opacity: 1 !important; transform: translateY(0) !important; }';
  document.head.appendChild(style);
});

// ===================== QUICK BAR LINKS =====================
document.querySelectorAll('.quick-item').forEach((item, i) => {
  const targets = ['#booking', '#home', '#location', '#location'];
  item.style.cursor = 'pointer';
  item.addEventListener('click', () => {
    document.querySelector(targets[i])?.scrollIntoView({ behavior: 'smooth' });
  });
});
