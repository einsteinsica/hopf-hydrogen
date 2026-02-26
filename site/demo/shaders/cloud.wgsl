// Probability cloud — instanced billboards with Gaussian falloff.
//
// Each instance is a tiny screen-aligned quad placed at the accumulated
// density point (x, y, z, weight). Additive blending makes overlapping
// dots brighten naturally, building up the probability cloud.
//
// Weights are normalized by maxWeight so all orbitals render at
// similar brightness regardless of their harmonic's dynamic range.

struct CloudUniforms {
  view: mat4x4f,
  proj: mat4x4f,
  eye: vec3f,
  pointSize: f32,
  maxWeight: f32,
};

@group(0) @binding(0) var<uniform> u: CloudUniforms;

struct VertexInput {
  // Per-vertex: quad corner (−1..1, −1..1)
  @location(0) quadPos: vec2f,
  // Per-instance: world position + weight
  @location(1) instancePos: vec3f,
  @location(2) instanceWeight: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) weight: f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;

  // Normalize weight by the orbital's peak so all orbitals have similar brightness
  let normW = in.instanceWeight / max(u.maxWeight, 1e-6);

  // Billboard: extract camera right and up from view matrix
  let right = vec3f(u.view[0][0], u.view[1][0], u.view[2][0]);
  let up    = vec3f(u.view[0][1], u.view[1][1], u.view[2][1]);

  let size = u.pointSize * sqrt(max(normW, 0.05));
  let worldPos = in.instancePos
    + right * in.quadPos.x * size
    + up    * in.quadPos.y * size;

  out.position = u.proj * u.view * vec4f(worldPos, 1.0);
  out.uv = in.quadPos;
  out.weight = normW;
  return out;
}

// Warm colormap: black → dark purple → orange → white
fn warm_colormap(t: f32) -> vec3f {
  let s = clamp(t, 0.0, 1.0);
  if (s < 0.33) {
    let f = s / 0.33;
    return mix(vec3f(0.0, 0.0, 0.0), vec3f(0.3, 0.0, 0.5), f);
  } else if (s < 0.66) {
    let f = (s - 0.33) / 0.33;
    return mix(vec3f(0.3, 0.0, 0.5), vec3f(1.0, 0.6, 0.0), f);
  } else {
    let f = (s - 0.66) / 0.34;
    return mix(vec3f(1.0, 0.6, 0.0), vec3f(1.0, 1.0, 1.0), f);
  }
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  // Gaussian dot
  let r2 = dot(in.uv, in.uv);
  let gauss = exp(-r2 * 8.0);

  // Warm colormap from normalized weight
  let color = warm_colormap(sqrt(clamp(in.weight, 0.0, 1.0)));

  // Alpha from normalized weight — consistent across all orbitals
  let alpha = gauss * in.weight * 0.08;

  // Discard fully transparent fragments
  if (alpha < 0.001) { discard; }

  return vec4f(color * alpha, alpha);
}
