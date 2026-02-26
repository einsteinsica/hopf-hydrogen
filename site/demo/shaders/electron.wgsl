// Electron energy ball — glowing plasma sphere that pulses with harmonic weight.
//
// Visual layers:
//   1. Hot white-blue core with animated energy crackle
//   2. Electric cyan mid-layer with Phong shading
//   3. Intense rim aura that bleeds outward
//   4. Pulsing intensity tied to time
//
// Opacity + scale track the harmonic weight: the electron swells and
// blazes when writing to the cloud, shrinks to a ghostly wisp at nodes.

struct Uniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    eye: vec3<f32>,
    time: f32,
    ePos: vec3<f32>,
    radius: f32,
    opacity: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) worldPos: vec3<f32>,
    @location(2) localPos: vec3<f32>,
};

@vertex fn vs_main(
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
) -> VsOut {
    // Scale radius by weight — electron shrinks at orbital nodes
    let w = clamp(u.opacity, 0.0, 1.0);
    let scale = 0.3 + 0.7 * sqrt(w);
    let worldPos = position * u.radius * scale + u.ePos;

    var out: VsOut;
    out.pos = u.proj * u.view * vec4<f32>(worldPos, 1.0);
    out.normal = normal;
    out.worldPos = worldPos;
    out.localPos = position;  // unit sphere coords for surface patterns
    return out;
}

// Cheap 3D noise-like energy pattern from overlapping sine waves
fn energy_pattern(p: vec3<f32>, t: f32) -> f32 {
    let a = sin(p.x * 8.0 + t * 3.7) * sin(p.y * 6.0 - t * 2.3) * sin(p.z * 7.0 + t * 4.1);
    let b = sin(p.x * 12.0 - t * 5.1) * sin(p.z * 10.0 + t * 3.3);
    return a * 0.6 + b * 0.4;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(u.eye - in.worldPos);
    let L = normalize(vec3<f32>(1.0, 2.0, 1.5));
    let NdotV = max(dot(N, V), 0.0);

    // ── Phong base ──
    let diff = max(dot(N, L), 0.0);
    let H = normalize(L + V);
    let spec = pow(max(dot(N, H), 0.0), 80.0);

    // ── Animated surface energy ──
    let energy = energy_pattern(in.localPos, u.time);
    let crackle = pow(max(energy, 0.0), 2.0);

    // ── Global pulse ──
    let pulse = 0.5 + 0.5 * sin(u.time * 6.0);

    // ── Layer 1: Hot core (view-facing = bright white-blue) ──
    let coreIntensity = pow(NdotV, 2.0);
    let core = vec3<f32>(0.8, 0.95, 1.0) * coreIntensity * (0.8 + 0.2 * pulse);

    // ── Layer 2: Electric cyan mid-layer ──
    let mid = vec3<f32>(0.15, 0.5, 0.7) + vec3<f32>(0.3, 0.7, 1.0) * diff;

    // ── Layer 3: Energy crackle (cyan-white sparks) ──
    let sparks = vec3<f32>(0.2, 0.5, 0.8) * crackle * 0.5;

    // ── Layer 4: Rim aura (intense bloom at edges) ──
    let rim = 1.0 - NdotV;
    let aura = pow(rim, 1.8) * vec3<f32>(0.3, 0.7, 1.0) * (1.5 + 0.5 * pulse);

    // ── Layer 5: Specular highlight ──
    let specColor = vec3<f32>(1.0, 1.0, 1.0) * spec * 1.2;

    // ── Combine all layers ──
    let color = core + mid * 0.6 + sparks + aura + specColor;

    // ── Opacity from harmonic weight ──
    // Clamp to visible range so fading is dramatic but never pops
    let w = clamp(u.opacity, 0.0, 1.0);
    let alpha = smoothstep(0.0, 0.2, w);

    if (alpha < 0.01) { discard; }

    return vec4<f32>(color * alpha, alpha);
}
