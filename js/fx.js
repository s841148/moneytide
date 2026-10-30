// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 畫面特效：紙花、事件橫幅、金額浮出、畫面震動、四季天氣。只負責視覺，不改遊戲狀態。
window.MT = window.MT || {};

(function () {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function off() { return reduced || MT.Audio.settings.anim === 'off'; }

  // ── 紙花 ──
  function confetti(amount) {
    if (off()) return;
    const cv = document.createElement('canvas');
    cv.className = 'fx-confetti';
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    document.body.appendChild(cv);
    const c = cv.getContext('2d');
    const colors = ['#ffb020', '#e8505b', '#2f86eb', '#22a06b', '#8b5cf6', '#ffd770'];
    const parts = [];
    const n = amount || 140;
    for (let i = 0; i < n; i++) {
      parts.push({
        x: cv.width / 2 + (Math.random() - 0.5) * cv.width * 0.3, y: cv.height * 0.35,
        vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
        r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length], shape: Math.random() < 0.3 ? 'coin' : 'rect',
      });
    }
    const start = performance.now();
    function frame(now) {
      const tt = now - start;
      c.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.globalAlpha = Math.max(0, 1 - tt / 2800);
        c.fillStyle = p.color;
        if (p.shape === 'coin') {
          c.beginPath();
          c.ellipse(0, 0, p.r, p.r * Math.abs(Math.cos(p.rot * 2)) + 1, 0, 0, Math.PI * 2);
          c.fill();
        } else {
          c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        }
        c.restore();
      });
      if (tt < 2800) requestAnimationFrame(frame);
      else cv.remove();
    }
    requestAnimationFrame(frame);
  }

  // ── 事件橫幅（不擋操作）──
  function banner(html, kind) {
    const el = document.createElement('div');
    el.className = 'fx-banner ' + (kind || '');
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1700);
    setTimeout(() => el.remove(), 2200);
  }

  // ── 金額從元素上方浮出 ──
  function moneyPop(target, amount) {
    if (!target || !amount || off()) return;
    const r = target.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'fx-money ' + (amount > 0 ? 'pos' : 'neg');
    el.textContent = (amount > 0 ? '+' : '') + MT.fmtMoney(amount);
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + 10) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  function shake() {
    if (off()) return;
    document.body.classList.remove('fx-shake');
    void document.body.offsetWidth;
    document.body.classList.add('fx-shake');
    setTimeout(() => document.body.classList.remove('fx-shake'), 500);
  }

  function flash(color) {
    if (off()) return;
    const el = document.createElement('div');
    el.className = 'fx-flash';
    el.style.background = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
  }

  // ── 四季天氣：景氣循環 = 春夏秋冬 ──
  const WEATHER = {
    recovery: { items: ['🌸', '🌱', '🌸'], cls: 'w-fall' }, // 春：落櫻
    expansion: { items: ['✨', '☀️', '✨'], cls: 'w-float' }, // 夏：陽光
    overheat: { items: ['🍂', '🍁', '🍂'], cls: 'w-fall' }, // 秋：落葉
    recession: { items: ['❄️', '❅', '❄️'], cls: 'w-fall' }, // 冬：下雪
  };
  let weatherPhase = null;

  function weather(phase) {
    const box = document.getElementById('weather');
    if (!box) return;
    box.className = 'weather season-' + phase;
    if (weatherPhase === phase && box.childElementCount) return;
    weatherPhase = phase;
    box.innerHTML = '';
    if (off()) return;
    const w = WEATHER[phase];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.className = 'w-item ' + w.cls;
      s.textContent = w.items[i % w.items.length];
      s.style.left = (Math.random() * 100) + '%';
      s.style.animationDelay = (-Math.random() * 12) + 's';
      s.style.animationDuration = (8 + Math.random() * 8) + 's';
      s.style.fontSize = (12 + Math.random() * 12) + 'px';
      box.appendChild(s);
    }
  }

  MT.FX = { confetti, banner, moneyPop, shake, flash, weather, off };
})();
