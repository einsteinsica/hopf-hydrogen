// Main entry — WebGPU init, frame loop, UI bindings.

import { OrbitCamera } from './camera.js?v=13';
import { Renderer } from './renderer.js?v=13';
import { DensityAccumulator } from './physics.js?v=13';

async function main() {
  const canvas = document.getElementById('canvas');
  const fallback = document.getElementById('fallback');

  // WebGPU check
  if (!navigator.gpu) {
    fallback.classList.remove('hidden');
    canvas.style.display = 'none';
    document.getElementById('controls').style.display = 'none';
    document.getElementById('stats').style.display = 'none';
    document.getElementById('info').style.display = 'none';
    return;
  }

  // Init WebGPU
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    fallback.classList.remove('hidden');
    fallback.querySelector('p').textContent = 'No WebGPU adapter found.';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  // Set canvas size
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;

  // Create subsystems
  const camera = new OrbitCamera(canvas);
  const renderer = new Renderer(device, context, format, camera);
  const physics = new DensityAccumulator();

  await renderer.init();

  // ── UI Bindings ─────────────────────────────────────────────

  // Speed slider
  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');
  speedSlider.addEventListener('input', () => {
    speedValue.textContent = speedSlider.value;
  });

  // Orbital selector
  const orbitalSelect = document.getElementById('orbital-select');
  const eli5Orbital = document.getElementById('eli5-orbital');

  const eli5Descriptions = {
    '1-0-0': '<strong>1s</strong> — Weight = 1 (constant). No filtering at all. Every point the quark path visits counts equally, so the cloud reveals the raw ergodic orbit. Spherical symmetry emerges from incommensurate rotations.',
    '2-0-0': '<strong>2s</strong> — Weight = y₃². Filters by the 4th S³ coordinate. The electron dims near the y₃=0 equator of S³, creating a radial node after projection.',
    '2-1-0': '<strong>2p (m=0)</strong> — Weight = y₂². Selects the y₂ axis of S³. The quark path only lights up where this coordinate is large.',
    '2-1-1': '<strong>2p (|m|=1)</strong> — Weight = y₀²+y₁². Selects the (y₀,y₁) plane of S³ — the Hopf fiber\'s own coordinates. Angular momentum from fiber geometry.',
    '3-0-0': '<strong>3s</strong> — Weight = (4y₃²−1)². A Gegenbauer polynomial on S³. Zero at y₃=±½ creates two nodal shells. Same quark path, more structure.',
    '3-1-0': '<strong>3p (m=0)</strong> — Weight = y₃²·y₂². Product of two S³ axes. Vanishes when either y₃ or y₂ is zero — two nodal surfaces from one filter.',
    '3-1-1': '<strong>3p (|m|=1)</strong> — Weight = y₃²·(y₀²+y₁²). Combines radial (y₃) and fiber (y₀,y₁) filtering on S³.',
    '3-2-0': '<strong>3d (m=0)</strong> — Weight = (2y₂²−y₀²−y₁²)². An angular harmonic on S³. Picks out regions where y₂ dominates the fiber plane.',
    '3-2-1': '<strong>3d (|m|=1)</strong> — Weight = y₂²·(y₀²+y₁²). Cross-term between the y₂ axis and the fiber plane.',
    '3-2-2': '<strong>3d (|m|=2)</strong> — Weight = (y₀²+y₁²)². Purely fiber-plane. Only the Hopf fiber coordinates matter — maximum angular momentum for l=2.',
    '4-0-0': '<strong>4s</strong> — Weight = (8y₃³−4y₃)². Cubic Gegenbauer — three zeros in y₃ create three nodal shells.',
    '4-1-0': '<strong>4p (m=0)</strong> — Weight = (12y₃²−2)²·y₂². Gegenbauer in y₃ times the y₂ axis. Radial nodes plus an angular node.',
    '4-1-1': '<strong>4p (|m|=1)</strong> — Weight = (12y₃²−2)²·(y₀²+y₁²). Gegenbauer times fiber plane. Radial structure meets angular momentum.',
    '4-2-0': '<strong>4d (m=0)</strong> — Weight = y₃²·(2y₂²−y₀²−y₁²)². Radial gate (y₃) combined with an angular cloverleaf harmonic.',
    '4-2-1': '<strong>4d (|m|=1)</strong> — Weight = y₃²·y₂²·(y₀²+y₁²). Triple product of three S³ directions. Complex nodal surface.',
    '4-2-2': '<strong>4d (|m|=2)</strong> — Weight = y₃²·(y₀²+y₁²)². Radial gate times squared fiber plane.',
    '4-3-0': '<strong>4f (m=0)</strong> — Weight = y₂²·(2y₂²−3(y₀²+y₁²))². The most angular l=3 harmonic. Six-fold structure on S³.',
    '4-3-1': '<strong>4f (|m|=1)</strong> — Weight = (4y₂²−(y₀²+y₁²))²·(y₀²+y₁²). Quartic angular structure from the S³ Laplacian eigenmodes.',
    '4-3-2': '<strong>4f (|m|=2)</strong> — Weight = y₂²·(y₀²+y₁²)². Mixed angular power from y₂ and fiber coordinates.',
    '4-3-3': '<strong>4f (|m|=3)</strong> — Weight = (y₀²+y₁²)³. Purely fiber-plane, sixth power. Maximum angular momentum for n=4 — all weight on the Hopf fiber equator.',
  };

  function updateEli5(orbital) {
    eli5Orbital.innerHTML = eli5Descriptions[orbital] || '';
  }

  orbitalSelect.addEventListener('change', () => {
    physics.setOrbital(orbitalSelect.value);
    updateEli5(orbitalSelect.value);
  });

  // Frequency sliders
  const freqIds = ['w1', 'w2', 'w3', 'w4'];
  const freqSliders = freqIds.map(id => document.getElementById(`${id}-slider`));
  const freqValues = freqIds.map(id => document.getElementById(`${id}-value`));

  function updateFreqs() {
    const freqs = freqSliders.map(s => parseFloat(s.value));
    freqValues.forEach((v, i) => { v.textContent = freqs[i].toFixed(2); });
    physics.setFreqs(freqs);
    renderer.freqs = freqs;
  }

  freqSliders.forEach(s => s.addEventListener('input', updateFreqs));

  // Randomize button
  document.getElementById('randomize-btn').addEventListener('click', () => {
    // Pick 4 random incommensurable frequencies in [0.1, 2.0]
    const freqs = [];
    for (let i = 0; i < 4; i++) {
      let f;
      do {
        f = 0.1 + Math.random() * 1.9;
        // Ensure no near-rational relations with existing
      } while (freqs.some(g => Math.abs(f / g - Math.round(f / g)) < 0.05));
      freqs.push(f);
    }
    freqs.forEach((f, i) => {
      freqSliders[i].value = f.toFixed(2);
      freqValues[i].textContent = f.toFixed(2);
    });
    physics.setFreqs(freqs);
    renderer.freqs = freqs;
  });

  // Layer toggles
  document.getElementById('toggle-fibers').addEventListener('change', (e) => {
    renderer.showFibers = e.target.checked;
  });
  document.getElementById('toggle-electron').addEventListener('change', (e) => {
    renderer.showElectron = e.target.checked;
  });
  document.getElementById('toggle-nucleus').addEventListener('change', (e) => {
    renderer.showNucleus = e.target.checked;
  });
  document.getElementById('toggle-cloud').addEventListener('change', (e) => {
    renderer.showCloud = e.target.checked;
  });

  // ── Stats ───────────────────────────────────────────────────

  const statSamples = document.getElementById('stat-samples');
  const statR2 = document.getElementById('stat-r2');
  const statA0 = document.getElementById('stat-a0');
  const statFps = document.getElementById('stat-fps');

  let frameCount = 0;
  let fpsTimer = 0;
  let lastFps = 0;

  // Telemetry elements (right panel)
  const telemQR = document.getElementById('telem-qr');
  const telemQG = document.getElementById('telem-qg');
  const telemQB = document.getElementById('telem-qb');
  const telemQ = document.getElementById('telem-q');
  const telemS3 = document.getElementById('telem-s3');
  const telemR3 = document.getElementById('telem-r3');
  const telemRadius = document.getElementById('telem-radius');
  const telemPsi = document.getElementById('telem-psi');
  const telemWeight = document.getElementById('telem-weight');
  const telemWeightBar = document.getElementById('telem-weight-bar');
  const telemTime = document.getElementById('telem-time');

  function fmtQ(q) {
    return q.map(v => (v < 0 ? '' : '\u2007') + v.toFixed(3)).join(' ');
  }

  function fmtV3(v) {
    return v.map(x => (x < 0 ? '' : '\u2007') + x.toFixed(3)).join(' ');
  }

  function updateStats(dt) {
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      lastFps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;
    }

    statSamples.textContent = `Samples: ${physics.count.toLocaleString()}`;
    statFps.textContent = `FPS: ${lastFps}`;

    // Update fit stats every 30 frames
    if (frameCount % 30 === 0 && physics.count > 1000) {
      const fit = physics.fitStats();
      statR2.textContent = `R²: ${fit.r2.toFixed(4)}`;
      statA0.textContent = `a₀: ${fit.a0.toFixed(3)}`;
    }

    // Update telemetry every 3 frames (20fps is smooth enough for numbers)
    if (frameCount % 3 === 0) {
      const s = physics.electronState();
      telemQR.textContent = fmtQ(s.qR);
      telemQG.textContent = fmtQ(s.qG);
      telemQB.textContent = fmtQ(s.qB);
      telemQ.textContent = fmtQ(s.q);
      telemS3.textContent = fmtQ(s.y);
      telemR3.textContent = fmtV3(s.pos);
      telemRadius.textContent = s.r.toFixed(3);
      telemPsi.textContent = (s.psi % (2 * Math.PI)).toFixed(3);
      const wNorm = s.w / (physics.maxWeight || 1);
      telemWeight.textContent = wNorm.toFixed(3);
      telemWeightBar.style.width = (wNorm * 100).toFixed(1) + '%';
      telemTime.textContent = s.t.toFixed(2);
    }
  }

  // ── Frame loop ──────────────────────────────────────────────

  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = now;

    const speed = parseInt(speedSlider.value);
    physics.tick(dt, speed);

    renderer.frame(dt, physics);
    updateStats(dt);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch(err => {
  console.error('Fatal error:', err);
  const fallback = document.getElementById('fallback');
  fallback.classList.remove('hidden');
  fallback.querySelector('p').textContent = `Error: ${err.message}`;
});
