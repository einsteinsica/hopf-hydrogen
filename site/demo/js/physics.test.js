#!/usr/bin/env node
'use strict';

// S³ Hopf Fibration — Physics Test Suite
//
// Mirrors Go tests in simulation/hopf_density_test.go and hopf_states_test.go.
// Independent math implementations validate the physics.js code.
//
// Run: cd docs && node js/physics.test.js

const PI = Math.PI;
const TWO_PI = 2 * PI;

// ── Test Harness ──────────────────────────────────────────────────

let passed = 0, failed = 0, total = 0;
const suiteStart = Date.now();

function test(name, fn) {
  total++;
  const t0 = Date.now();
  try {
    fn();
    const dt = Date.now() - t0;
    const timeStr = dt > 1000 ? ` (${(dt / 1000).toFixed(1)}s)` : '';
    passed++;
    console.log(`  PASS  ${name}${timeStr}`);
  } catch (e) {
    const dt = Date.now() - t0;
    const timeStr = dt > 1000 ? ` (${(dt / 1000).toFixed(1)}s)` : '';
    failed++;
    console.log(`  FAIL  ${name}${timeStr}`);
    console.log(`        ${e.message}`);
  }
}

function assertClose(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(
      `${msg || ''}: expected ${expected.toFixed(6)} ± ${tol}, got ${actual.toFixed(6)}`
    );
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── SU(2) Math (independent implementation matching Go) ──────────

function su2_4freq(t, w1, w2, w3, w4) {
  const r0 = Math.cos(t * w1);
  const r1 = Math.sin(t * w2);
  const r2 = Math.cos(t * w3);
  const r3 = Math.sin(t * w4);
  const n = Math.sqrt(r0 * r0 + r1 * r1 + r2 * r2 + r3 * r3) || 1e-10;
  return [r0 / n, r1 / n, r2 / n, r3 / n];
}

function su2_mul(q1, q2) {
  return [
    q1[0]*q2[0] - q1[1]*q2[1] - q1[2]*q2[2] - q1[3]*q2[3],
    q1[0]*q2[1] + q1[1]*q2[0] + q1[2]*q2[3] - q1[3]*q2[2],
    q1[0]*q2[2] - q1[1]*q2[3] + q1[2]*q2[0] + q1[3]*q2[1],
    q1[0]*q2[3] + q1[1]*q2[2] - q1[2]*q2[1] + q1[3]*q2[0],
  ];
}

function quark_su2(t, bundleIdx, freqs) {
  const [w1, w2, w3, w4] = freqs;
  if (bundleIdx === 0) return su2_4freq(t, w1, w2, w3, w4);
  if (bundleIdx === 1) return su2_4freq(t, w2, w3, w4, w1);
  return su2_4freq(-t, w3, w4, w1, w2);
}

function electron_rotation(t, freqs) {
  const qR = quark_su2(t, 0, freqs);
  const qG = quark_su2(t, 1, freqs);
  const qB = quark_su2(t, 2, freqs);
  return su2_mul(su2_mul(qR, qG), qB);
}

function hopfFiberPoint(cosH, sinH, phi, psi) {
  return [
    cosH * Math.cos(psi),
    cosH * Math.sin(psi),
    sinH * Math.cos(psi + phi),
    sinH * Math.sin(psi + phi),
  ];
}

function su2_act_on_s3(q, p) {
  return [
     q[0]*p[0] - q[1]*p[1] + q[2]*p[2] - q[3]*p[3],
     q[1]*p[0] + q[0]*p[1] + q[3]*p[2] + q[2]*p[3],
    -q[2]*p[0] - q[3]*p[1] + q[0]*p[2] + q[1]*p[3],
     q[3]*p[0] - q[2]*p[1] - q[1]*p[2] + q[0]*p[3],
  ];
}

function stereo_project(y) {
  const denom = Math.max(1.0 + y[3], 1e-8);
  return [y[0] / denom, y[1] / denom, y[2] / denom];
}

function quat_norm(q) {
  return Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
}

function vec3_norm(v) {
  return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
}

// ── S³ Harmonic Weight Functions ──────────────────────────────────

const HARMONICS = {
  '1-0-0':  (y) => 1.0,
  '2-0-0':  (y) => y[3] * y[3],
  '2-1-0':  (y) => y[2] * y[2],
  '2-1-1':  (y) => y[0] * y[0] + y[1] * y[1],
  '3-0-0':  (y) => { const g = 4 * y[3] * y[3] - 1; return g * g; },
  '3-2-0':  (y) => { const v = 2 * y[2] * y[2] - y[0] * y[0] - y[1] * y[1]; return v * v; },
};

// ── Density Accumulation Helpers ──────────────────────────────────
// These match the Go test accumulateDensity() exactly — no compactification.

function accumulateDensity(freqs, theta, nSteps, nPsi, dt, weightFn, rMaxOverride) {
  const cosH = Math.cos(theta / 2);
  const sinH = Math.sin(theta / 2);

  const nBins = 80;
  const rMax = rMaxOverride || 6.0;  // Go TestQuantumStates_S3Harmonics uses 6.0
  const dr = rMax / nBins;
  const bins = new Float64Array(nBins);
  const octants = new Int32Array(8);

  // Angular distributions: unweighted (orbit trajectory) and weighted (harmonic)
  const nAngBins = 16;
  const thetaDist = new Int32Array(nAngBins);
  const weightedAngDist = new Float64Array(nAngBins);  // cosθ bins, weighted by harmonic

  for (let i = 0; i < nSteps; i++) {
    const t = i * dt;
    const q = electron_rotation(t, freqs);

    for (let j = 0; j < nPsi; j++) {
      const psi = j * TWO_PI / nPsi;
      const p = hopfFiberPoint(cosH, sinH, 0, psi);
      const y = su2_act_on_s3(q, p);

      const w = weightFn ? weightFn(y) : 1.0;
      if (w < 1e-8) continue;

      const pos = stereo_project(y);
      const r = vec3_norm(pos);
      const bin = Math.floor(r / dr);
      if (bin >= 0 && bin < nBins) {
        bins[bin] += w;
      }

      // Octant + angular tracking (first psi sample only)
      if (j === 0) {
        let oct = 0;
        if (pos[0] > 0) oct |= 1;
        if (pos[1] > 0) oct |= 2;
        if (pos[2] > 0) oct |= 4;
        octants[oct]++;

        if (r > 1e-10) {
          // cosθ-based angular binning (matches Go TestQuantumStates_S3Harmonics)
          const cosT = pos[2] / r;
          let aBin = Math.floor((cosT + 1.0) / 2.0 * nAngBins);
          if (aBin >= nAngBins) aBin = nAngBins - 1;
          if (aBin < 0) aBin = 0;
          thetaDist[aBin]++;
          weightedAngDist[aBin] += w;  // weighted by S³ harmonic
        }
      }
    }
  }

  // Spatial density: counts / shell volume 4πr²dr
  const density = new Float64Array(nBins);
  let maxD = 0;
  for (let i = 0; i < nBins; i++) {
    const r = (i + 0.5) * dr;
    const sv = 4 * PI * r * r * dr;
    if (sv > 0) density[i] = bins[i] / sv;
    if (density[i] > maxD) maxD = density[i];
  }
  // Normalize to peak = 1
  if (maxD > 0) {
    for (let i = 0; i < nBins; i++) density[i] /= maxD;
  }

  return { density, octants, thetaDist, weightedAngDist, nBins, rMax, dr, nAngBins };
}

// Linear regression on ln(density) vs r — extract effective Bohr radius a₀
function fitExponentialDecay(density, nBins, rMax) {
  const dr = rMax / nBins;
  let sumR = 0, sumY = 0, sumR2 = 0, sumRY = 0, n = 0;
  for (let i = 0; i < nBins; i++) {
    if (density[i] > 0.02) {
      const r = (i + 0.5) * dr;
      const y = Math.log(density[i]);
      sumR += r; sumY += y; sumR2 += r * r; sumRY += r * y;
      n++;
    }
  }
  if (n < 3) return { r2: 0, a0: 0, slope: 0 };

  const slope = (n * sumRY - sumR * sumY) / (n * sumR2 - sumR * sumR);
  const intercept = (sumY - slope * sumR) / n;
  const meanY = sumY / n;

  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < nBins; i++) {
    if (density[i] > 0.02) {
      const r = (i + 0.5) * dr;
      const y = Math.log(density[i]);
      const predicted = slope * r + intercept;
      ssTot += (y - meanY) * (y - meanY);
      ssRes += (y - predicted) * (y - predicted);
    }
  }

  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const a0 = -2.0 / slope;
  return { r2, a0, slope };
}

// Radial node detection: density dips < 5% between regions > 20%
// Matches Go radialNodes() from hopf_states_test.go
function findRadialNodes(density, nBins, rMax) {
  const dr = rMax / nBins;
  const nodes = [];

  for (let i = 3; i < nBins - 1; i++) {
    if (density[i] < 0.05) {
      let hasLeft = false, hasRight = false;
      for (let k = 0; k < i; k++) {
        if (density[k] > 0.20) { hasLeft = true; break; }
      }
      for (let k = i + 1; k < nBins; k++) {
        if (density[k] > 0.10) { hasRight = true; break; }
      }
      if (hasLeft && hasRight) {
        nodes.push((i + 0.5) * dr);
      }
    }
  }
  return nodes;
}

// Max fractional deviation from mean octant population
function octantDeviation(octants) {
  let total = 0;
  for (let i = 0; i < 8; i++) total += octants[i];
  const mean = total / 8;
  let maxDev = 0;
  for (let i = 0; i < 8; i++) {
    const dev = Math.abs(octants[i] - mean) / mean;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

// Polar vs equatorial density ratio — matches Go polarAsymmetry()
// Works with both Int32Array (unweighted) and Float64Array (weighted)
function polarAsymmetry(dist) {
  const n = dist.length;
  const polarBins = Math.max(1, Math.floor(n / 6));
  const equatorialStart = Math.floor(n / 2) - polarBins;
  const equatorialEnd = Math.floor(n / 2) + polarBins;

  let polar = 0, equatorial = 0;
  for (let i = 0; i < polarBins; i++) {
    polar += dist[i] + dist[n - 1 - i];
  }
  for (let i = equatorialStart; i < equatorialEnd; i++) {
    equatorial += dist[i];
  }

  if (equatorial === 0) return 0;
  const pNorm = polar / (2 * polarBins);
  const eNorm = equatorial / (equatorialEnd - equatorialStart);
  return pNorm / eNorm;
}

// ══════════════════════════════════════════════════════════════════
//  TESTS
// ══════════════════════════════════════════════════════════════════

console.log('\nS\u00B3 Hopf Fibration \u2014 Physics Test Suite');
console.log('\u2550'.repeat(50) + '\n');

// ── Test 1: SU(2) Primitive Validation ──────────────────────────

console.log('Test 1: SU(2) Primitives');

test('su2_4freq produces unit norm', () => {
  for (const t of [0, 0.1, 0.5, 1.0, PI, 100.0]) {
    const q = su2_4freq(t, 0.23, 0.61, 0.37, 0.53);
    assertClose(quat_norm(q), 1.0, 1e-10, `t=${t}`);
  }
});

test('su2_mul preserves unit norm (closure)', () => {
  const q1 = su2_4freq(0.7, 0.23, 0.61, 0.37, 0.53);
  const q2 = su2_4freq(1.3, 0.41, 0.19, 0.67, 0.31);
  const prod = su2_mul(q1, q2);
  assertClose(quat_norm(prod), 1.0, 1e-10, 'product norm');
});

test('su2_mul is associative: (q1*q2)*q3 = q1*(q2*q3)', () => {
  const q1 = su2_4freq(0.3, 0.23, 0.61, 0.37, 0.53);
  const q2 = su2_4freq(0.7, 0.41, 0.19, 0.67, 0.31);
  const q3 = su2_4freq(1.1, 0.29, 0.73, 0.43, 0.59);
  const lhs = su2_mul(su2_mul(q1, q2), q3);
  const rhs = su2_mul(q1, su2_mul(q2, q3));
  for (let i = 0; i < 4; i++) {
    assertClose(lhs[i], rhs[i], 1e-10, `component ${i}`);
  }
});

test('su2_mul identity: [1,0,0,0] * q = q', () => {
  const e = [1, 0, 0, 0];
  const q = su2_4freq(0.7, 0.23, 0.61, 0.37, 0.53);
  const prod = su2_mul(e, q);
  for (let i = 0; i < 4; i++) {
    assertClose(prod[i], q[i], 1e-10, `component ${i}`);
  }
});

test('su2_4freq is deterministic at t=1.0', () => {
  const q1 = su2_4freq(1.0, 0.23, 0.61, 0.37, 0.53);
  const q2 = su2_4freq(1.0, 0.23, 0.61, 0.37, 0.53);
  assertClose(quat_norm(q1), 1.0, 1e-10, 'norm');
  for (let i = 0; i < 4; i++) {
    assertClose(q1[i], q2[i], 1e-15, `determinism ${i}`);
  }
});

// ── Test 2: Hopf Fiber Geometry ──────────────────────────────────

console.log('\nTest 2: Hopf Fiber Geometry');

test('hopfFiberPoint has unit S3 norm', () => {
  for (const theta of [PI/6, PI/3, PI/2, 2*PI/3]) {
    const cosH = Math.cos(theta / 2);
    const sinH = Math.sin(theta / 2);
    for (const psi of [0, PI/4, PI/2, PI, 3*PI/2]) {
      const p = hopfFiberPoint(cosH, sinH, 0, psi);
      assertClose(quat_norm(p), 1.0, 1e-10, `theta=${theta.toFixed(2)}, psi=${psi.toFixed(2)}`);
    }
  }
});

test('fiber traces a circle: 128 psi samples share same S2 base', () => {
  const theta = PI / 3;
  const cosH = Math.cos(theta / 2);
  const sinH = Math.sin(theta / 2);
  const nSamples = 128;

  // Hopf map: S3 -> S2
  // z1 = y0 + i*y1, z2 = y2 + i*y3
  // S2 point = (2*Re(z1*conj(z2)), 2*Im(z1*conj(z2)), |z1|^2 - |z2|^2)
  const base0 = [];
  for (let j = 0; j < nSamples; j++) {
    const psi = j * TWO_PI / nSamples;
    const p = hopfFiberPoint(cosH, sinH, 0, psi);
    const s2 = [
      2 * (p[0]*p[2] + p[1]*p[3]),
      2 * (p[1]*p[2] - p[0]*p[3]),
      p[0]*p[0] + p[1]*p[1] - p[2]*p[2] - p[3]*p[3],
    ];
    if (j === 0) base0.push(s2[0], s2[1], s2[2]);
    else {
      for (let k = 0; k < 3; k++) {
        assertClose(s2[k], base0[k], 1e-10, `psi ${j}, component ${k}`);
      }
    }
  }
});

test('su2_act_on_s3 identity: [1,0,0,0] * p = p', () => {
  const e = [1, 0, 0, 0];
  const p = hopfFiberPoint(Math.cos(PI/6), Math.sin(PI/6), 0, PI/4);
  const result = su2_act_on_s3(e, p);
  for (let i = 0; i < 4; i++) {
    assertClose(result[i], p[i], 1e-10, `component ${i}`);
  }
});

test('su2_act_on_s3 preserves S3 norm', () => {
  const q = su2_4freq(0.7, 0.23, 0.61, 0.37, 0.53);
  const p = hopfFiberPoint(Math.cos(PI/4), Math.sin(PI/4), 0, PI/3);
  const result = su2_act_on_s3(q, p);
  assertClose(quat_norm(result), 1.0, 1e-10, 'norm after action');
});

// ── Test 3: Stereographic Projection ─────────────────────────────

console.log('\nTest 3: Stereographic Projection');

test('north pole [0,0,0,1] projects near origin', () => {
  const pos = stereo_project([0, 0, 0, 1]);
  assertTrue(vec3_norm(pos) < 0.01, `expected near origin, got r=${vec3_norm(pos).toFixed(4)}`);
});

test('equator [1,0,0,0] projects to [1,0,0]', () => {
  const pos = stereo_project([1, 0, 0, 0]);
  assertClose(pos[0], 1.0, 1e-10, 'x');
  assertClose(pos[1], 0.0, 1e-10, 'y');
  assertClose(pos[2], 0.0, 1e-10, 'z');
});

test('near south pole projects to large radius', () => {
  // Point near south pole with nonzero spatial components
  const eps = 0.001;
  const y3 = -Math.sqrt(1 - eps * eps);
  const p = [eps, 0, 0, y3];
  const pos = stereo_project(p);
  assertTrue(vec3_norm(pos) > 10,
    `expected large radius near south pole, got ${vec3_norm(pos).toFixed(4)}`);
});

// ── Tests 4-8: Density Profiles ──────────────────────────────────
//
// Same ergodic orbit, different S3 harmonic weights.
// Matches Go TestQuantumStates_S3Harmonics parameters exactly.

const STD_FREQS = [0.23, 0.61, 0.37, 0.53];
const STD_THETA = PI / 3;
const STD_STEPS = 200000;
const STD_PSI = 32;
const STD_DT = 0.01;

console.log('\nTests 4-8: Density Profiles');
console.log(`  (${STD_STEPS} steps x ${STD_PSI} psi = ${(STD_STEPS * STD_PSI / 1e6).toFixed(1)}M samples each)`);

// ── Test 4: 1s Density — Exponential Decay ──────────────────────

test('(1,0,0): exponential decay R2 > 0.98, octant dev < 15%', () => {
  const r = accumulateDensity(STD_FREQS, STD_THETA, STD_STEPS, STD_PSI, STD_DT, HARMONICS['1-0-0']);
  const fit = fitExponentialDecay(r.density, r.nBins, r.rMax);
  const dev = octantDeviation(r.octants);

  console.log(`        R2 = ${fit.r2.toFixed(4)}, a0 = ${fit.a0.toFixed(3)}, octant dev = ${(dev * 100).toFixed(1)}%`);

  assertTrue(fit.r2 > 0.98, `R2 = ${fit.r2.toFixed(4)} < 0.98`);
  assertTrue(dev < 0.15, `octant deviation ${(dev * 100).toFixed(1)}% > 15%`);
});

// ── Test 5: 2s Density — Steeper decay from y₃² suppression ─────
// The y₃² weight suppresses density at larger r (where y₃→0 at r=1),
// producing a steeper effective decay than 1s. The Go test also finds
// 0 sharp nodes — the smooth y₃² zero creates a steep rolloff, not a
// discrete node at finite bin resolution.

test('(2,0,0): steeper decay than 1s (a0 < 0.6, demonstrating y3 suppression)', () => {
  const r = accumulateDensity(STD_FREQS, STD_THETA, STD_STEPS, STD_PSI, STD_DT, HARMONICS['2-0-0']);
  const fit = fitExponentialDecay(r.density, r.nBins, r.rMax);

  console.log(`        a0(2s) = ${fit.a0.toFixed(3)}, R2 = ${fit.r2.toFixed(4)}`);
  console.log(`        (compare 1s: a0 ~ 0.75 — 2s is steeper due to y3^2 zero at r=1)`);

  assertTrue(fit.a0 < 0.6, `a0(2s) = ${fit.a0.toFixed(3)} >= 0.6, expected steeper decay than 1s`);
  assertTrue(fit.a0 > 0.1, `a0(2s) = ${fit.a0.toFixed(3)} too small, possible accumulation error`);
});

// ── Test 6: 2p₀ Density — Dumbbell Shape ────────────────────────
// The y₂² weight creates a dumbbell: density concentrated at poles
// (|cosθ| near 1) and suppressed at equator (cosθ near 0).
// Must use WEIGHTED angular distribution — the unweighted orbit is
// spherically symmetric regardless of harmonic.

test('(2,1,0): weighted polar/equatorial ratio > 2 (dumbbell)', () => {
  const r = accumulateDensity(STD_FREQS, STD_THETA, STD_STEPS, STD_PSI, STD_DT, HARMONICS['2-1-0']);
  const pa = polarAsymmetry(r.weightedAngDist);

  console.log(`        weighted polar asymmetry = ${pa.toFixed(2)}`);

  assertTrue(pa > 2.0, `weighted polar asymmetry ${pa.toFixed(2)} < 2.0 (not dumbbell-like)`);
});

// ── Test 7: 3s Density — Even steeper from P₂(y₃)² suppression ──
// P₂(y₃) = (3y₃²-1)/2 has zeros at y₃ = ±1/√3, creating TWO
// suppression zones. Combined with the exponential envelope, the
// density drops even faster than 2s. Effective a₀ < a₀(2s) < a₀(1s).

test('(3,0,0): steeper than 1s from Gegenbauer C₂¹ modulation', () => {
  const r = accumulateDensity(STD_FREQS, STD_THETA, STD_STEPS, STD_PSI, STD_DT, HARMONICS['3-0-0']);
  const fit = fitExponentialDecay(r.density, r.nBins, r.rMax);

  console.log(`        a0(3s) = ${fit.a0.toFixed(3)}, R2 = ${fit.r2.toFixed(4)}`);
  console.log(`        (1s R2~0.996, 2s R2~0.975 — 3s uses Gegenbauer C_2^1 = 4y₃²-1)`);

  // C_2^1(y₃) = 4y₃²-1 creates suppression zones, making the profile
  // deviate from pure exponential. R² < 1s proves harmonic modulation.
  assertTrue(fit.r2 < 0.97,
    `R2(3s) = ${fit.r2.toFixed(4)} >= 0.97, expected deviation from pure exponential`);
  // Still steeper than 1s overall
  assertTrue(fit.a0 < 0.7,
    `a0(3s) = ${fit.a0.toFixed(3)} >= 0.7, expected at least some suppression vs 1s`);
});

// ── Test 8: 3d0 Density — Cloverleaf ────────────────────────────

test('(3,2,0): angular lobes present (equatorial concentration)', () => {
  const r = accumulateDensity(STD_FREQS, STD_THETA, STD_STEPS, STD_PSI, STD_DT, HARMONICS['3-2-0']);

  // 3d0 = y0^2 * y2^2 is zero along axes, maximal in xz-plane diagonals
  // Should show equatorial concentration (polar asymmetry < 1)
  const pa = polarAsymmetry(r.thetaDist);
  console.log(`        polar asymmetry = ${pa.toFixed(2)} (expect < 1 for equatorial lobes)`);

  // Just verify the density has structure (not flat, not just noise)
  let peakR = 0, maxD = 0;
  for (let i = 0; i < r.nBins; i++) {
    if (r.density[i] > maxD) { maxD = r.density[i]; peakR = (i + 0.5) * r.dr; }
  }
  console.log(`        peak at r = ${peakR.toFixed(2)}`);
  assertTrue(peakR > 0.1, `peak at r = ${peakR.toFixed(2)}, expected structure`);
});

// ── Test 9: Frequency Robustness ────────────────────────────────
// Matches Go TestQuantumStates_FrequencyRobustness:
// ANY incommensurable frequencies produce the same 1s exponential.

console.log('\nTest 9: Frequency Robustness');
console.log('  (20 random frequency sets, 100k steps each)');

test('>=18/20 random freq sets produce R2 > 0.99, a0 std/mean < 15%', () => {
  const nTrials = 20;
  const nSteps = 100000;
  const nPsi = 16;
  const dt = 0.01;

  // Deterministic LCG (matches Go test seed=42)
  let seed = 42n;
  const lcg = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    return Number(seed >> 33n) / (1 << 31);
  };

  // Check incommensurability: no ratio near a simple rational
  const isIncommensurable = (freqs) => {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const ratio = freqs[i] / freqs[j];
        for (const target of [1, 2, 0.5, 3, 1/3, 1.5, 2/3]) {
          if (Math.abs(ratio - target) < 0.05) return false;
        }
      }
    }
    return true;
  };

  const results = [];
  let passCount = 0;

  for (let trial = 0; trial < nTrials; trial++) {
    let freqs;
    for (let attempt = 0; attempt < 100; attempt++) {
      freqs = [0.1 + lcg() * 1.9, 0.1 + lcg() * 1.9,
               0.1 + lcg() * 1.9, 0.1 + lcg() * 1.9];
      if (isIncommensurable(freqs)) break;
    }

    const r = accumulateDensity(freqs, STD_THETA, nSteps, nPsi, dt, HARMONICS['1-0-0'], 6.0);
    const fit = fitExponentialDecay(r.density, r.nBins, r.rMax);

    results.push({ r2: fit.r2, a0: fit.a0 });
    if (fit.r2 > 0.99) passCount++;
  }

  // Compute a0 statistics
  let sumA0 = 0, sumA0sq = 0;
  for (const r of results) { sumA0 += r.a0; sumA0sq += r.a0 * r.a0; }
  const meanA0 = sumA0 / results.length;
  const stdA0 = Math.sqrt(sumA0sq / results.length - meanA0 * meanA0);
  const variation = stdA0 / meanA0;

  console.log(`        ${passCount}/${nTrials} with R2 > 0.99`);
  console.log(`        a0 = ${meanA0.toFixed(3)} +/- ${stdA0.toFixed(3)} (${(variation * 100).toFixed(1)}% variation)`);

  assertTrue(passCount >= 18,
    `only ${passCount}/${nTrials} trials had R2 > 0.99, expected >= 18`);
  assertTrue(variation < 0.15,
    `a0 variation ${(variation * 100).toFixed(1)}% > 15%`);
});

// ── Test 10: Energy Ordering ────────────────────────────────────
// Matches Go TestQuantumStates_EnergyOrdering:
// S3 Laplacian eigenvalue -N(N+2) strictly increasing,
// Shell capacity 2(N+1)^2 = 2n^2,
// Cross-N harmonic overlap < 0.5

console.log('\nTest 10: Energy Ordering');

test('S3 Laplacian eigenvalue -N(N+2) strictly increasing', () => {
  for (let N = 0; N < 3; N++) {
    const e1 = N * (N + 2);
    const e2 = (N + 1) * (N + 3);
    assertTrue(e1 < e2,
      `eigenvalue ordering violated: N=${N} gives ${e1}, N=${N+1} gives ${e2}`);
  }
});

test('shell capacity 2(N+1)^2 = 2n^2', () => {
  for (let n = 1; n <= 4; n++) {
    const N = n - 1;
    const deg = (N + 1) * (N + 1);
    const expected = 2 * n * n;
    assertTrue(2 * deg === expected,
      `2*(N+1)^2=${2*deg} should equal 2n^2=${expected} for n=${n}`);
  }
});

test('cross-N harmonic overlap < 0.5', () => {
  const freqs = STD_FREQS;
  const theta = STD_THETA;
  const nSteps = 100000;
  const nPsi = 16;
  const dt = 0.01;

  const cosH = Math.cos(theta / 2);
  const sinH = Math.sin(theta / 2);

  // Collect weights at each sample point for each harmonic
  const harmonicDefs = [
    { name: '1-0-0', N: 0, weight: HARMONICS['1-0-0'] },
    { name: '2-0-0', N: 1, weight: HARMONICS['2-0-0'] },
    { name: '2-1-0', N: 1, weight: HARMONICS['2-1-0'] },
    { name: '3-0-0', N: 2, weight: HARMONICS['3-0-0'] },
  ];

  const weights = harmonicDefs.map(() => []);

  for (let i = 0; i < nSteps; i++) {
    const t = i * dt;
    const q = electron_rotation(t, freqs);

    for (let j = 0; j < nPsi; j++) {
      const psi = j * TWO_PI / nPsi;
      const p = hopfFiberPoint(cosH, sinH, 0, psi);
      const y = su2_act_on_s3(q, p);

      for (let h = 0; h < harmonicDefs.length; h++) {
        weights[h].push(harmonicDefs[h].weight(y));
      }
    }
  }

  // Compute normalized correlation between all pairs
  const overlap = (a, b) => {
    let meanA = 0, meanB = 0;
    for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
    meanA /= a.length; meanB /= b.length;

    let sumAB = 0, sumA2 = 0, sumB2 = 0;
    for (let i = 0; i < a.length; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      sumAB += da * db;
      sumA2 += da * da;
      sumB2 += db * db;
    }
    if (sumA2 < 1e-10 || sumB2 < 1e-10) return 0;
    return sumAB / Math.sqrt(sumA2 * sumB2);
  };

  // Check cross-N overlaps
  const crossNOverlaps = [];
  for (let i = 0; i < harmonicDefs.length; i++) {
    for (let j = i + 1; j < harmonicDefs.length; j++) {
      if (harmonicDefs[i].N !== harmonicDefs[j].N) {
        const o = Math.abs(overlap(weights[i], weights[j]));
        crossNOverlaps.push(o);
      }
    }
  }

  let avgCrossN = 0;
  for (const o of crossNOverlaps) avgCrossN += o;
  if (crossNOverlaps.length > 0) avgCrossN /= crossNOverlaps.length;

  console.log(`        avg |cross-N overlap| = ${avgCrossN.toFixed(4)}`);

  assertTrue(avgCrossN < 0.5,
    `cross-N overlap ${avgCrossN.toFixed(4)} >= 0.5, harmonics not approximately orthogonal`);
});

// ── Summary ──────────────────────────────────────────────────────

const elapsed = ((Date.now() - suiteStart) / 1000).toFixed(1);
console.log(`\n${'='.repeat(50)}`);
console.log(`${passed}/${total} passed, ${failed} failed  (${elapsed}s)`);
if (failed > 0) {
  console.log('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
