// SU(2) math + density accumulator for S³ Hopf fibration demo.
//
// Ports the validated SU(2) math from fiber.wgsl and hopf_density_test.go.
// The DensityAccumulator deposits trail points from the electron's trajectory
// on its single Hopf fiber — the probability cloud emerges as the
// time-averaged position, with density from dwell time rather than weights.

const PI = Math.PI;
const TWO_PI = 2 * PI;

// ── SU(2) Math ──────────────────────────────────────────────────

// 4-frequency normalized SU(2) path.
// Uses 4 independent frequencies (one per S³ component), then normalizes
// to the unit 3-sphere. Matches fiber.wgsl:su2_4freq exactly.
export function su2_4freq(t, w1, w2, w3, w4) {
  const r0 = Math.cos(t * w1);
  const r1 = Math.sin(t * w2);
  const r2 = Math.cos(t * w3);
  const r3 = Math.sin(t * w4);
  const n = Math.sqrt(r0 * r0 + r1 * r1 + r2 * r2 + r3 * r3) || 1e-10;
  return [r0 / n, r1 / n, r2 / n, r3 / n];
}

// SU(2) group multiplication: q1 * q2.
// Each element [ar, ai, br, bi] encodes a = ar+i*ai, b = br+i*bi.
export function su2_mul(q1, q2) {
  return [
    q1[0]*q2[0] - q1[1]*q2[1] - q1[2]*q2[2] - q1[3]*q2[3],
    q1[0]*q2[1] + q1[1]*q2[0] + q1[2]*q2[3] - q1[3]*q2[2],
    q1[0]*q2[2] - q1[1]*q2[3] + q1[2]*q2[0] + q1[3]*q2[1],
    q1[0]*q2[3] + q1[1]*q2[2] - q1[2]*q2[1] + q1[3]*q2[0],
  ];
}

// Quark SU(2) rotation with Z₃ cyclic frequency permutation.
// bundleIdx: 0=up1, 1=up2, 2=down (counter-rotating).
export function quark_su2(t, bundleIdx, freqs) {
  const [w1, w2, w3, w4] = freqs;
  if (bundleIdx === 0) {
    return su2_4freq(t, w1, w2, w3, w4);
  } else if (bundleIdx === 1) {
    return su2_4freq(t, w2, w3, w4, w1);
  } else {
    return su2_4freq(-t, w3, w4, w1, w2);
  }
}

// Composed electron rotation: q_R * q_G * q_B
export function electron_rotation(t, freqs) {
  const qR = quark_su2(t, 0, freqs);
  const qG = quark_su2(t, 1, freqs);
  const qB = quark_su2(t, 2, freqs);
  return su2_mul(su2_mul(qR, qG), qB);
}

// ── Hopf Fiber Geometry ─────────────────────────────────────────

// S³ point on Hopf fiber at base (theta, phi), position psi along fiber.
export function hopfFiberPoint(cosH, sinH, phi, psi) {
  return [
    cosH * Math.cos(psi),
    cosH * Math.sin(psi),
    sinH * Math.cos(psi + phi),
    sinH * Math.sin(psi + phi),
  ];
}

// Left action of SU(2) on S³ point.
// Mirrors su2ActOnS3 from hopf_density_test.go exactly.
export function su2_act_on_s3(q, p) {
  return [
    q[0]*p[0] - q[1]*p[1] + q[2]*p[2] - q[3]*p[3],
    q[1]*p[0] + q[0]*p[1] + q[3]*p[2] + q[2]*p[3],
   -q[2]*p[0] - q[3]*p[1] + q[0]*p[2] + q[1]*p[3],
    q[3]*p[0] - q[2]*p[1] - q[1]*p[2] + q[0]*p[3],
  ];
}

// Stereographic projection from south pole (0,0,0,-1) to R³.
export function stereo_project(y) {
  const denom = Math.max(1.0 + y[3], 1e-8);
  return [y[0] / denom, y[1] / denom, y[2] / denom];
}

// ── S³ Harmonic Weight Functions ────────────────────────────────

// Each orbital corresponds to a different S³ harmonic evaluated at the
// pre-projection S³ point y = (y0, y1, y2, y3). The weight |Y_N|²
// determines how much each sample contributes to the probability cloud.

export const HARMONICS = {
  // n=1
  '1-0-0': {
    name: '(1,0,0)',
    label: 'n=1: Y=1 (constant)',
    weight: (y) => 1.0,
  },
  // n=2
  '2-0-0': {
    name: '(2,0,0)',
    label: 'n=2, l=0: Y=y₃',
    weight: (y) => y[3] * y[3],
  },
  '2-1-0': {
    name: '(2,1,0)',
    label: 'n=2, l=1, m=0: Y=y₂',
    weight: (y) => y[2] * y[2],
  },
  '2-1-1': {
    name: '(2,1,1)',
    label: 'n=2, l=1, |m|=1: torus',
    weight: (y) => y[0] * y[0] + y[1] * y[1],
  },
  // n=3
  '3-0-0': {
    name: '(3,0,0)',
    label: 'n=3, l=0: C₂¹(y₃)',
    weight: (y) => {
      // Gegenbauer C_2^1(y₃) = 4y₃²-1
      const g = 4 * y[3] * y[3] - 1;
      return g * g;
    },
  },
  '3-1-0': {
    name: '(3,1,0)',
    label: 'n=3, l=1, m=0',
    weight: (y) => y[3] * y[3] * y[2] * y[2],
  },
  '3-1-1': {
    name: '(3,1,1)',
    label: 'n=3, l=1, |m|=1',
    weight: (y) => y[3] * y[3] * (y[0] * y[0] + y[1] * y[1]),
  },
  '3-2-0': {
    name: '(3,2,0)',
    label: 'n=3, l=2, m=0: cloverleaf',
    weight: (y) => {
      const v = 2 * y[2] * y[2] - y[0] * y[0] - y[1] * y[1];
      return v * v;
    },
  },
  '3-2-1': {
    name: '(3,2,1)',
    label: 'n=3, l=2, |m|=1',
    weight: (y) => y[2] * y[2] * (y[0] * y[0] + y[1] * y[1]),
  },
  '3-2-2': {
    name: '(3,2,2)',
    label: 'n=3, l=2, |m|=2',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      return xy2 * xy2;
    },
  },
  // n=4
  '4-0-0': {
    name: '(4,0,0)',
    label: 'n=4, l=0: C₃¹(y₃)',
    weight: (y) => {
      // Gegenbauer C_3^1(y₃) = 8y₃³-4y₃
      const g = 8 * y[3] * y[3] * y[3] - 4 * y[3];
      return g * g;
    },
  },
  '4-1-0': {
    name: '(4,1,0)',
    label: 'n=4, l=1, m=0',
    weight: (y) => {
      // Gegenbauer C_2^2(y₃) = 12y₃²-2
      const g = 12 * y[3] * y[3] - 2;
      return g * g * y[2] * y[2];
    },
  },
  '4-1-1': {
    name: '(4,1,1)',
    label: 'n=4, l=1, |m|=1',
    weight: (y) => {
      // Gegenbauer C_2^2(y₃) = 12y₃²-2
      const g = 12 * y[3] * y[3] - 2;
      return g * g * (y[0] * y[0] + y[1] * y[1]);
    },
  },
  '4-2-0': {
    name: '(4,2,0)',
    label: 'n=4, l=2, m=0',
    weight: (y) => {
      const v = 2 * y[2] * y[2] - y[0] * y[0] - y[1] * y[1];
      return y[3] * y[3] * v * v;
    },
  },
  '4-2-1': {
    name: '(4,2,1)',
    label: 'n=4, l=2, |m|=1',
    weight: (y) => y[3] * y[3] * y[2] * y[2] * (y[0] * y[0] + y[1] * y[1]),
  },
  '4-2-2': {
    name: '(4,2,2)',
    label: 'n=4, l=2, |m|=2',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      return y[3] * y[3] * xy2 * xy2;
    },
  },
  '4-3-0': {
    name: '(4,3,0)',
    label: 'n=4, l=3, m=0',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      const v = 2 * y[2] * y[2] - 3 * xy2;
      return y[2] * y[2] * v * v;
    },
  },
  '4-3-1': {
    name: '(4,3,1)',
    label: 'n=4, l=3, |m|=1',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      const v = 4 * y[2] * y[2] - xy2;
      return v * v * xy2;
    },
  },
  '4-3-2': {
    name: '(4,3,2)',
    label: 'n=4, l=3, |m|=2',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      return y[2] * y[2] * xy2 * xy2;
    },
  },
  '4-3-3': {
    name: '(4,3,3)',
    label: 'n=4, l=3, |m|=3',
    weight: (y) => {
      const xy2 = y[0] * y[0] + y[1] * y[1];
      return xy2 * xy2 * xy2;
    },
  },
};

// ── Density Accumulator ─────────────────────────────────────────

export class DensityAccumulator {
  constructor(maxPoints = 1000000) {
    this.maxPoints = maxPoints;
    // Ring buffer: x, y, z, weight per point
    this.points = new Float32Array(maxPoints * 4);
    this.count = 0;
    this.time = 0;
    this.maxWeight = 0;

    // Default params
    this.freqs = [0.23, 0.61, 0.37, 0.53];
    this.orbital = '1-0-0';
    this.theta = PI / 3;   // electron base point on S²
    this.nPsi = 16;         // sample along the full fiber

    // Precompute trig for the electron's single base point
    this._updateTrigCache();

    // Radial histogram for live R² calculation
    // 80 bins / 8.0 rMax matches Go test parameters for node detection
    this.nBins = 80;
    this.rMax = 8.0;
    this.dr = this.rMax / this.nBins;
    this.radialBins = new Float64Array(this.nBins);
  }

  _updateTrigCache() {
    this.cosH = Math.cos(this.theta / 2);
    this.sinH = Math.sin(this.theta / 2);
  }

  setFreqs(freqs) {
    this.freqs = freqs;
    this.reset();
  }

  setOrbital(orbital) {
    this.orbital = orbital;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.time = 0;
    this.maxWeight = 0;
    this.radialBins.fill(0);
  }

  // Advance simulation by dt seconds, depositing trail points from
  // the electron's actual trajectory on its single Hopf fiber.
  // Each point is weighted by the S³ harmonic at that position —
  // the orbital shape emerges because trail points in nodal regions
  // get near-zero weight (dim/invisible in the cloud shader).
  tick(dt, speedMul) {
    const harmonic = HARMONICS[this.orbital];
    if (!harmonic) return;

    // One point per step, so use enough steps for a smooth trail
    const steps = Math.max(16, Math.round(speedMul * 16));
    const subDt = dt * speedMul / steps;

    for (let s = 0; s < steps; s++) {
      this.time += subDt;
      const q = electron_rotation(this.time, this.freqs);

      // One trail point per step. The electron's S¹ fiber phase precesses
      // with time (quantum phase evolution e^{-iEt/ℏ}). Golden ratio × π
      // ensures incommensurability with the SU(2) frequencies, giving
      // ergodic S³ coverage while every point comes from the electron.
      const phi = 0.5 * (Math.sqrt(5) - 1);  // golden ratio
      const psi = this.time * PI * phi;
      const p = hopfFiberPoint(this.cosH, this.sinH, 0, psi);
      const y = su2_act_on_s3(q, p);

      // Harmonic weight at the electron's S³ position gives orbital shape
      const w = harmonic.weight(y);
      if (w < 1e-8) continue;
      if (w > this.maxWeight) this.maxWeight = w;

      const pos = stereo_project(y);

      // Raw radius for radial binning (before compactification)
      const rawR = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);

      const bin = Math.floor(rawR / this.dr);
      if (bin >= 0 && bin < this.nBins) {
        this.radialBins[bin] += w;
      }

      // Conformal compactification for GPU rendering
      const compactR = 2.5;
      if (rawR > 0.001) {
        const sc = compactR * Math.tanh(rawR / compactR) / rawR;
        pos[0] *= sc;
        pos[1] *= sc;
        pos[2] *= sc;
      }

      if (this.count >= this.maxPoints) continue;

      const idx = this.count * 4;
      this.points[idx]     = pos[0];
      this.points[idx + 1] = pos[1];
      this.points[idx + 2] = pos[2];
      this.points[idx + 3] = w;
      this.count++;
    }
  }

  // Electron position for the current simulation time.
  // Also caches the harmonic weight at this position for opacity.
  electronPosition() {
    const q = electron_rotation(this.time, this.freqs);
    const phi = 0.5 * (Math.sqrt(5) - 1);
    const psi = this.time * PI * phi;
    const p = hopfFiberPoint(this.cosH, this.sinH, 0, psi);
    const y = su2_act_on_s3(q, p);

    // Cache weight at electron's S³ position for opacity feedback
    const harmonic = HARMONICS[this.orbital];
    this._electronWeight = harmonic ? harmonic.weight(y) : 1.0;

    const pos = stereo_project(y);

    // Conformal compactification — matches fiber.wgsl hopf_rotated()
    // Without this, the electron flies to infinity near the S³ south pole
    const compactR = 2.5;
    const r = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);
    if (r > 0.001) {
      const s = compactR * Math.tanh(r / compactR) / r;
      pos[0] *= s;
      pos[1] *= s;
      pos[2] *= s;
    }
    return pos;
  }

  // Harmonic weight at the electron's current S³ position (0..1).
  // High weight = electron is writing to the cloud; low = passing through a node.
  electronWeight() {
    return this._electronWeight || 0;
  }

  // Full electron state for telemetry — exposes the entire computation chain.
  electronState() {
    const qR = quark_su2(this.time, 0, this.freqs);
    const qG = quark_su2(this.time, 1, this.freqs);
    const qB = quark_su2(this.time, 2, this.freqs);
    const q = su2_mul(su2_mul(qR, qG), qB);

    const phi = 0.5 * (Math.sqrt(5) - 1);
    const psi = this.time * PI * phi;
    const p = hopfFiberPoint(this.cosH, this.sinH, 0, psi);
    const y = su2_act_on_s3(q, p);

    const harmonic = HARMONICS[this.orbital];
    const w = harmonic ? harmonic.weight(y) : 1.0;

    const pos = stereo_project(y);
    const r = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);

    return { t: this.time, qR, qG, qB, q, y, pos, psi, w, r };
  }

  // Compute R² and a₀ from radial histogram via exponential fit.
  fitStats() {
    // Convert to spatial density: counts / (4πr²dr)
    const density = new Float64Array(this.nBins);
    let maxD = 0;
    for (let i = 0; i < this.nBins; i++) {
      const r = (i + 0.5) * this.dr;
      const sv = 4 * PI * r * r * this.dr;
      if (sv > 0) density[i] = this.radialBins[i] / sv;
      if (density[i] > maxD) maxD = density[i];
    }
    if (maxD > 0) {
      for (let i = 0; i < this.nBins; i++) density[i] /= maxD;
    }

    // Linear regression on ln(density) vs r
    let sumR = 0, sumY = 0, sumR2 = 0, sumRY = 0, n = 0;
    for (let i = 0; i < this.nBins; i++) {
      if (density[i] > 0.02) {
        const r = (i + 0.5) * this.dr;
        const y = Math.log(density[i]);
        sumR += r;
        sumY += y;
        sumR2 += r * r;
        sumRY += r * y;
        n++;
      }
    }
    if (n < 3) return { r2: 0, a0: 0 };

    const slope = (n * sumRY - sumR * sumY) / (n * sumR2 - sumR * sumR);
    const intercept = (sumY - slope * sumR) / n;
    const meanY = sumY / n;

    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < this.nBins; i++) {
      if (density[i] > 0.02) {
        const r = (i + 0.5) * this.dr;
        const y = Math.log(density[i]);
        const predicted = slope * r + intercept;
        ssTot += (y - meanY) * (y - meanY);
        ssRes += (y - predicted) * (y - predicted);
      }
    }

    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const a0 = -2.0 / slope;
    return { r2, a0 };
  }
}
