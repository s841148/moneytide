// 錢潮 MoneyTide © 2026 麥麥的遊戲工廠 保留所有權利 All rights reserved. 詳見 LICENSE
// 音效與背景音樂：全部用 Web Audio 即時合成，不需要任何音檔，離線也能播。
// 瀏覽器規定要使用者先點一下畫面才能出聲，所以第一次點擊時才啟動。
window.MT = window.MT || {};

(function () {
  const KEY = 'mt_settings';
  const S = { sfx: true, music: true, volume: 0.7, anim: 'normal' };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* 用預設值 */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  let ctx = null;
  let master, sfxBus, musicBus, noiseBuf;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = S.volume;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = S.sfx ? 0.6 : 0;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = S.music ? 0.2 : 0;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // 單一音：o = { type, vol, attack, slide, lp, bus }
  function tone(f, t, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const v = o.vol == null ? 0.3 : o.vol;
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    let out = g;
    if (o.lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = o.lp;
      g.connect(fl);
      out = fl;
    }
    out.connect(o.bus || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = o.ftype || 'bandpass';
    fl.frequency.value = o.freq || 2000;
    fl.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(o.bus || sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function seq(notes, t, step, o) {
    notes.forEach((m, i) => { if (m != null) tone(midi(m), t + i * step, (o && o.dur) || step * 1.6, o); });
  }

  // ── 音效 ──
  const SFX = {
    click(t) { tone(1200, t, 0.04, { type: 'square', vol: 0.05 }); },
    dice(t) {
      for (let i = 0; i < 7; i++) noise(t + i * 0.07 + Math.random() * 0.03, 0.05, { freq: 2500 + Math.random() * 2000, q: 3, vol: 0.25 });
    },
    step(t, k) { tone(620 + (k || 0) * 45, t, 0.07, { type: 'triangle', vol: 0.16 }); },
    coin(t) { tone(988, t, 0.08, { type: 'square', vol: 0.1 }); tone(1319, t + 0.07, 0.3, { type: 'square', vol: 0.1 }); },
    cash(t) {
      noise(t, 0.05, { freq: 5000, vol: 0.2 });
      tone(2093, t + 0.04, 0.4, { type: 'triangle', vol: 0.18 });
      tone(2637, t + 0.1, 0.5, { type: 'triangle', vol: 0.14 });
    },
    loss(t) {
      tone(392, t, 0.18, { type: 'sawtooth', vol: 0.12, lp: 1200, slide: 330 });
      tone(294, t + 0.16, 0.35, { type: 'sawtooth', vol: 0.12, lp: 1000, slide: 220 });
    },
    alarm(t) {
      tone(110, t, 0.7, { vol: 0.4, slide: 40 });
      for (let i = 0; i < 3; i++) {
        tone(880, t + i * 0.32, 0.16, { type: 'square', vol: 0.09, lp: 2500 });
        tone(660, t + i * 0.32 + 0.16, 0.16, { type: 'square', vol: 0.09, lp: 2500 });
      }
    },
    success(t) { seq([72, 76, 79, 84], t, 0.08, { type: 'triangle', vol: 0.16 }); },
    wrong(t) {
      tone(220, t, 0.22, { type: 'square', vol: 0.1, lp: 800, slide: 180 });
      tone(196, t + 0.2, 0.3, { type: 'square', vol: 0.1, lp: 800, slide: 150 });
    },
    gavel(t) {
      [0, 0.22].forEach((d) => {
        noise(t + d, 0.06, { freq: 900, ftype: 'lowpass', vol: 0.35 });
        tone(190, t + d, 0.15, { vol: 0.35, slide: 90 });
      });
    },
    news(t) { seq([79, 86, 91], t, 0.09, { type: 'square', vol: 0.08, lp: 3000 }); },
    card(t) {
      noise(t, 0.15, { ftype: 'highpass', freq: 3500, vol: 0.12 });
      tone(1760, t + 0.05, 0.18, { vol: 0.08, slide: 2637 });
    },
    zap(t) { tone(1600, t, 0.3, { type: 'sawtooth', vol: 0.1, slide: 90, lp: 3000 }); },
    siren(t) { for (let i = 0; i < 3; i++) { tone(700, t + i * 0.24, 0.12, { type: 'square', vol: 0.08 }); tone(950, t + i * 0.24 + 0.12, 0.12, { type: 'square', vol: 0.08 }); } },
    shield(t) {
      tone(523, t, 0.5, { type: 'triangle', vol: 0.12 });
      tone(784, t, 0.5, { type: 'triangle', vol: 0.09 });
      tone(1047, t + 0.06, 0.5, { vol: 0.07 });
    },
    tick(t) { tone(1000, t, 0.04, { type: 'square', vol: 0.07 }); },
    sold(t) { SFX.gavel(t); SFX.cash(t + 0.45); },
    fanfare(t) {
      seq([60, 64, 67, 72], t, 0.12, { type: 'sawtooth', vol: 0.1, lp: 2500 });
      [72, 76, 79].forEach((m) => tone(midi(m), t + 0.5, 1.1, { type: 'sawtooth', vol: 0.08, lp: 2500, attack: 0.03 }));
      noise(t + 0.5, 0.6, { ftype: 'highpass', freq: 6000, vol: 0.06 });
    },
    chime(t) {
      tone(1319, t, 0.5, { vol: 0.13 });
      tone(1760, t + 0.08, 0.6, { vol: 0.1 });
      tone(2637, t + 0.16, 0.7, { vol: 0.07 });
    },
    stamp(t) { noise(t, 0.06, { freq: 400, ftype: 'lowpass', vol: 0.4 }); tone(120, t, 0.12, { vol: 0.35 }); },
    whoosh(t) { noise(t, 0.3, { freq: 900, q: 0.6, vol: 0.12 }); },
    happy(t) { seq([79, 83, 86], t, 0.07, { type: 'triangle', vol: 0.14 }); },
  };

  function play(name, delay, arg) {
    if (!S.sfx || !ensure() || !SFX[name]) return;
    SFX[name](ctx.currentTime + 0.01 + (delay || 0), arg);
  }

  // ── 背景音樂：依景氣階段切換情緒 ──
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
  const MOODS = {
    menu: { bpm: 92, root: 60, scale: 'major', prog: [0, 5, 3, 4], drums: 0, lead: 0.45 },
    recovery: { bpm: 100, root: 55, scale: 'major', prog: [0, 4, 5, 3], drums: 1, lead: 0.5 },
    expansion: { bpm: 116, root: 60, scale: 'major', prog: [0, 4, 5, 3], drums: 2, lead: 0.6 },
    overheat: { bpm: 128, root: 62, scale: 'mixo', prog: [0, 6, 3, 4], drums: 2, lead: 0.75 },
    recession: { bpm: 80, root: 57, scale: 'minor', prog: [0, 5, 2, 6], drums: 0, lead: 0.35 },
  };

  const Music = {
    mood: 'menu', next: 'menu', timer: null, step: 0, bar: 0, t: 0, lastNote: 0,
    start() {
      if (Music.timer || !ensure()) return;
      Music.t = ctx.currentTime + 0.1;
      Music.timer = setInterval(Music.tick, 40);
    },
    setMood(m) { if (MOODS[m]) Music.next = m; },
    tick() {
      if (!ctx) return;
      while (Music.t < ctx.currentTime + 0.2) {
        Music.schedule(Music.t);
        const mood = MOODS[Music.mood];
        Music.t += 60 / mood.bpm / 4; // 16 分音符
        Music.step = (Music.step + 1) % 16;
        if (Music.step === 0) {
          Music.bar += 1;
          if (Music.next !== Music.mood) { Music.mood = Music.next; Music.bar = 0; }
        }
      }
    },
    schedule(t) {
      if (!S.music) return;
      const mood = MOODS[Music.mood];
      const sc = SCALES[mood.scale];
      const degree = mood.prog[Music.bar % mood.prog.length];
      const note = (d) => mood.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
      const chord = [note(degree), note(degree + 2), note(degree + 4)];
      const beat = 60 / mood.bpm;
      const bus = musicBus;
      const st = Music.step;
      // 和弦墊底
      if (st === 0) chord.forEach((m) => tone(midi(m - 12), t, beat * 3.8, { type: 'triangle', vol: 0.045, attack: 0.25, bus }));
      // 低音
      if (st === 0 || st === 8) tone(midi(chord[0] - 24), t, beat * 1.6, { type: 'triangle', vol: 0.16, attack: 0.01, bus });
      if (mood.drums && st === 12) tone(midi(chord[2] - 24), t, beat * 0.8, { type: 'triangle', vol: 0.1, bus });
      // 旋律：在和弦音附近隨機走動
      if (st % 2 === 0 && Math.random() < mood.lead) {
        const pool = Math.random() < 0.6 ? chord.map((m) => m + 12) : [0, 1, 2, 3, 4, 5, 6].map((d) => note(d) + 12);
        let m = pool[Math.floor(Math.random() * pool.length)];
        if (Music.lastNote && Math.abs(m - Music.lastNote) > 7) m = m > Music.lastNote ? m - 12 : m + 12;
        Music.lastNote = m;
        tone(midi(m), t, beat * 0.45, { type: 'square', vol: 0.035, lp: 1800, bus });
      }
      // 鼓
      if (mood.drums >= 1 && (st === 4 || st === 12)) noise(t, 0.04, { ftype: 'highpass', freq: 7000, vol: 0.05, bus });
      if (mood.drums >= 2) {
        if (st % 4 === 0) tone(150, t, 0.12, { vol: 0.3, slide: 45, bus });
        if (st % 4 === 2) noise(t, 0.03, { ftype: 'highpass', freq: 8000, vol: 0.035, bus });
      }
    },
  };

  function set(key, value) {
    S[key] = value;
    save();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (key === 'volume') master.gain.setTargetAtTime(value, now, 0.05);
    if (key === 'sfx') sfxBus.gain.setTargetAtTime(value ? 0.6 : 0, now, 0.05);
    if (key === 'music') musicBus.gain.setTargetAtTime(value ? 0.2 : 0, now, 0.1);
  }

  // 第一次點擊或按鍵後才啟動聲音
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (ensure()) Music.start(); }, { passive: true }));

  MT.Audio = { play, set, settings: S, setMood: Music.setMood, ensure };
})();
