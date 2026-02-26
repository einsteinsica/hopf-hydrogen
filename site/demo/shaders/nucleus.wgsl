// Z₃ braid quark rendering — copied from viewer, unchanged.

struct NucleusUniforms {
  view: mat4x4f,
  proj: mat4x4f,
  eye: vec3f,
  time: f32,
  nucleusScale: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: NucleusUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) normal: vec3f,
  @location(2) worldPos: vec3f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let worldPos = in.position * u.nucleusScale;
  out.position = u.proj * u.view * vec4f(worldPos, 1.0);
  out.color = in.color;
  out.normal = in.normal;
  out.worldPos = worldPos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let lightDir = normalize(vec3f(0.5, 1.0, 0.8));
  let viewDir = normalize(u.eye - in.worldPos);

  let ambient = 0.35;
  let diffuse = max(dot(n, lightDir), 0.0) * 0.6;
  let spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 64.0) * 0.6;
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5) * 0.6;

  let color = in.color * (ambient + diffuse) + vec3f(spec + rim);
  return vec4f(color, 1.0);
}
