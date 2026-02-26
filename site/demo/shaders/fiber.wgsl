// Hopf fiber tube rendering — adapted for standalone demo.
//
// The electron is rendered as a special fiber tube within the same pipeline.
// Quark fibers use individual quark_su2() rotations; the electron fiber
// uses the composed rotation q_R·q_G·q_B, keeping it visually synced
// with the fiber system.

struct FiberUniforms {
  view: mat4x4f,
  proj: mat4x4f,
  eye: vec3f,
  time: f32,
  fiberScale: f32,
  electronPhase: f32,
  hopfSpeed: f32,
  _pad: f32,
  // Frequency uniforms — controllable from sliders
  w1: f32,
  w2: f32,
  w3: f32,
  w4: f32,
};

@group(0) @binding(0) var<uniform> u: FiberUniforms;

struct VertexInput {
  @location(0) fiberParams: vec3f,  // (cos(θ/2), sin(θ/2), φ)
  @location(1) tubeParams: vec3f,   // (ψ_base, tubeAngle, tubeRadius)
  @location(2) hue: f32,
  @location(3) isElectron: f32,
  @location(4) fiberParam: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) hue: f32,
  @location(3) isElectron: f32,
  @location(4) fiberParam: f32,
};

fn hopf_rotated(cosH: f32, sinH: f32, phi: f32, psi: f32,
                ar: f32, ai: f32, br: f32, bi: f32, scale: f32) -> vec3f {
  let x0 = cosH * cos(psi);
  let x1 = cosH * sin(psi);
  let x2 = sinH * cos(psi + phi);
  let x3 = sinH * sin(psi + phi);

  let y0 = ar*x0 - ai*x1 + br*x2 - bi*x3;
  let y1 = ai*x0 + ar*x1 + bi*x2 + br*x3;
  let y2 = -br*x0 - bi*x1 + ar*x2 + ai*x3;
  let y3 = bi*x0 - br*x1 - ai*x2 + ar*x3;

  let denom = max(1.0 + y3, 0.05);
  let raw = vec3f(y0 / denom, y1 / denom, y2 / denom);

  let compactR = 2.5;
  let r = length(raw);
  let s = select(scale, scale * compactR * tanh(r / compactR) / r, r > 0.001);

  return raw * s;
}

fn su2_mul(a1r: f32, a1i: f32, b1r: f32, b1i: f32,
           a2r: f32, a2i: f32, b2r: f32, b2i: f32) -> vec4f {
  return vec4f(
    a1r*a2r - a1i*a2i - b1r*b2r - b1i*b2i,
    a1r*a2i + a1i*a2r + b1r*b2i - b1i*b2r,
    a1r*b2r - a1i*b2i + b1r*a2r + b1i*a2i,
    a1r*b2i + a1i*b2r - b1r*a2i + b1i*a2r
  );
}

fn su2_4freq(t: f32, w1: f32, w2: f32, w3: f32, w4: f32) -> vec4f {
  let raw = vec4f(cos(t * w1), sin(t * w2), cos(t * w3), sin(t * w4));
  let n = max(length(raw), 0.0001);
  return raw / n;
}

fn quark_su2(t: f32, bundleIdx: u32) -> vec4f {
  var tEff = t;
  if (bundleIdx == 0u) {
    return su2_4freq(tEff, u.w1, u.w2, u.w3, u.w4);
  } else if (bundleIdx == 1u) {
    return su2_4freq(tEff, u.w2, u.w3, u.w4, u.w1);
  } else {
    tEff = -t;
    return su2_4freq(tEff, u.w3, u.w4, u.w1, u.w2);
  }
}

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = l - c * 0.5;
  var rgb: vec3f;
  let h6 = h * 6.0;
  if (h6 < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (h6 < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (h6 < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (h6 < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (h6 < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(m);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;

  let cosH = in.fiberParams.x;
  let sinH = in.fiberParams.y;
  let phi = in.fiberParams.z;
  let psi = in.tubeParams.x;
  let tubeAngle = in.tubeParams.y;
  let tubeR = in.tubeParams.z;

  var bundleIdx: u32;
  if (in.hue < 0.17) {
    bundleIdx = 0u;
  } else if (in.hue < 0.5) {
    bundleIdx = 1u;
  } else {
    bundleIdx = 2u;
  }

  let t = u.time * u.hopfSpeed;
  let q = quark_su2(t, bundleIdx);
  let ar = q.x; let ai = q.y; let br = q.z; let bi = q.w;

  let center = hopf_rotated(cosH, sinH, phi, psi, ar, ai, br, bi, u.fiberScale);

  let eps = 0.02;
  let ahead = hopf_rotated(cosH, sinH, phi, psi + eps, ar, ai, br, bi, u.fiberScale);
  let T = normalize(ahead - center);

  var up_vec = vec3f(0.0, 1.0, 0.0);
  if (abs(T.y) > 0.9) { up_vec = vec3f(1.0, 0.0, 0.0); }
  let N = normalize(cross(T, up_vec));
  let B = cross(T, N);

  let worldPos = center + tubeR * (cos(tubeAngle) * N + sin(tubeAngle) * B);
  let worldNormal = normalize(cos(tubeAngle) * N + sin(tubeAngle) * B);

  out.position = u.proj * u.view * vec4f(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.hue = in.hue;
  out.isElectron = in.isElectron;
  out.fiberParam = in.fiberParam;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.worldNormal);
  let lightDir = normalize(vec3f(0.5, 1.0, 0.8));
  let viewDir = normalize(u.eye - in.worldPos);

  let ambient = 0.4;
  let diffuse = max(dot(n, lightDir), 0.0) * 0.55;
  let halfVec = normalize(lightDir + viewDir);
  let spec = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.5;

  // Distance along fiber from electron phase (wrapping)
  let rawDist = abs(in.fiberParam - u.electronPhase);
  let dist = min(rawDist, 1.0 - rawDist);

  // S¹ flow bands: light pulses traveling along every fiber
  let nBands = 3.0;
  let flowPhase = fract(in.fiberParam * nBands - u.electronPhase * nBands);
  let flowPulse = smoothstep(0.35, 0.50, flowPhase) * smoothstep(0.65, 0.50, flowPhase);

  // Quark fibers: colored (R/G/B) + flow bands, semi-transparent
  let baseColor = hsl2rgb(in.hue, 0.85, 0.65);
  let litColor = baseColor * (ambient + diffuse) + vec3f(spec * 0.4);

  let brightness = 0.7 + 0.3 * flowPulse;
  let alpha = 0.25 + 0.25 * flowPulse;
  return vec4f(litColor * brightness, alpha);
}
