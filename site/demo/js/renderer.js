// Renderer — 3 pipelines: cloud, fibers (incl. electron), nucleus.
//
// The electron is rendered as a special fiber tube within the fiber pipeline,
// using the composed rotation q_R·q_G·q_B. This keeps it visually synced
// with the quark fibers rather than floating independently as a sphere.

const PI = Math.PI;
const TWO_PI = 2 * PI;

// ── Inlined electron shader ─────────────────────────────────────────
// Volumetric energy orb: bright white-gold core, orange mid, warm red edge.
// Treats the sphere as a volume — NdotV = depth of gaze through the orb.
const ELECTRON_SHADER = /* wgsl */`
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
    let w = clamp(u.opacity, 0.0, 1.0);
    let scale = 0.4 + 0.6 * sqrt(w);
    let worldPos = position * u.radius * scale + u.ePos;

    var out: VsOut;
    out.pos = u.proj * u.view * vec4<f32>(worldPos, 1.0);
    out.normal = normal;
    out.worldPos = worldPos;
    out.localPos = position;
    return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(u.eye - in.worldPos);
    let NdotV = max(dot(N, V), 0.0);

    // Depth: how far "into" the orb we're looking (1 = dead center, 0 = grazing)
    let depth = NdotV;
    let rim = 1.0 - depth;

    // Pulse
    let pulse = 0.5 + 0.5 * sin(u.time * 4.0);

    // ── Volumetric glow layers ──

    // Layer 1: White-hot core (center of orb, very bright)
    let coreGlow = pow(depth, 3.0);
    let core = vec3<f32>(1.0, 0.95, 0.85) * coreGlow * (2.0 + 0.5 * pulse);

    // Layer 2: Orange-gold mid energy
    let midBand = pow(depth, 1.2) * (1.0 - pow(depth, 3.0));
    let mid = vec3<f32>(1.0, 0.55, 0.1) * midBand * 2.5;

    // Layer 3: Warm red-magenta soft edge glow
    let edgeGlow = pow(rim, 1.2) * (1.0 - pow(rim, 4.0));
    let edge = vec3<f32>(1.0, 0.2, 0.3) * edgeGlow * 1.8;

    // Layer 4: Outer halo (very soft, extends to silhouette)
    let halo = pow(rim, 2.5);
    let outerGlow = vec3<f32>(0.8, 0.3, 0.5) * halo * (1.0 + 0.3 * pulse);

    let color = core + mid + edge + outerGlow;

    // Alpha: dense at center, soft falloff at edge (volumetric feel)
    let baseAlpha = 0.3 + 0.7 * pow(depth, 0.8);

    // Modulate by normalized harmonic weight — hard cutoff so electron
    // vanishes when outside the cloud, only glows inside dense regions
    let w = clamp(u.opacity, 0.0, 1.0);
    let weightAlpha = 0.1 + 0.9 * smoothstep(0.15, 0.6, w);
    let alpha = baseAlpha * weightAlpha;

    return vec4<f32>(color * alpha, alpha);
}
`;

export class Renderer {
  constructor(device, context, format, camera) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.camera = camera;
    this.time = 0;

    // Visibility flags
    this.showFibers = true;
    this.showNucleus = true;
    this.showCloud = true;
    this.showElectron = true;

    // Frequency uniforms for fiber shader
    this.freqs = [0.23, 0.61, 0.37, 0.53];
  }

  async init() {
    // Load shaders
    const nocache = { cache: 'no-store' };
    const [fiberCode, nucleusCode, cloudCode] = await Promise.all([
      fetch('shaders/fiber.wgsl', nocache).then(r => r.text()),
      fetch('shaders/nucleus.wgsl', nocache).then(r => r.text()),
      fetch('shaders/cloud.wgsl', nocache).then(r => r.text()),
    ]);

    // Electron shader inlined to avoid caching issues
    const electronCode = ELECTRON_SHADER;

    // Create shader modules
    const fiberModule = this.device.createShaderModule({ code: fiberCode });
    const nucleusModule = this.device.createShaderModule({ code: nucleusCode });
    const cloudModule = this.device.createShaderModule({ code: cloudCode });
    const electronModule = this.device.createShaderModule({ code: electronCode });

    // Shared bind group layout pattern: single uniform buffer
    const uniformBGL = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    // ── Fiber pipeline (includes electron as special fiber) ───
    this.fiberPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [uniformBGL] }),
      vertex: {
        module: fiberModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 9 * 4, // fiberParams(3) + tubeParams(3) + hue(1) + isElectron(1) + fiberParam(1)
          attributes: [
            { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // fiberParams
            { shaderLocation: 1, offset: 12, format: 'float32x3' },  // tubeParams
            { shaderLocation: 2, offset: 24, format: 'float32'   },  // hue
            { shaderLocation: 3, offset: 28, format: 'float32'   },  // isElectron
            { shaderLocation: 4, offset: 32, format: 'float32'   },  // fiberParam
          ],
        }],
      },
      fragment: {
        module: fiberModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // ── Nucleus pipeline ────────────────────────────────────────
    this.nucleusPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [uniformBGL] }),
      vertex: {
        module: nucleusModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 9 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0,  format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
          ],
        }],
      },
      fragment: {
        module: nucleusModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    // ── Cloud pipeline (instanced billboards) ───────────────────
    this.cloudPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [uniformBGL] }),
      vertex: {
        module: cloudModule,
        entryPoint: 'vs_main',
        buffers: [
          // Per-vertex: quad corners
          {
            arrayStride: 2 * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
            ],
          },
          // Per-instance: position(3) + weight(1)
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0,  format: 'float32x3' },
              { shaderLocation: 2, offset: 12, format: 'float32'   },
            ],
          },
        ],
      },
      fragment: {
        module: cloudModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    // ── Electron pipeline (glowing energy orb, additive blend) ────
    this.electronPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [uniformBGL] }),
      vertex: {
        module: electronModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 6 * 4, // position(3) + normal(3)
          attributes: [
            { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // position
            { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
          ],
        }],
      },
      fragment: {
        module: electronModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    // ── Uniform buffers ─────────────────────────────────────────
    // Fiber: 16*4 (view) + 16*4 (proj) + 3*4 (eye) + 1*4 (time)
    //        + 1*4 (fiberScale) + 1*4 (electronPhase) + 1*4 (hopfSpeed) + 1*4 (pad)
    //        + 4*4 (w1-w4) = 48 floats = 192 bytes, pad to 256
    this.fiberUniformBuffer = this._createUniformBuffer(256);
    this.nucleusUniformBuffer = this._createUniformBuffer(160);
    this.cloudUniformBuffer = this._createUniformBuffer(160);
    this.electronUniformBuffer = this._createUniformBuffer(192);

    // Bind groups
    this.fiberBindGroup = this._createBindGroup(uniformBGL, this.fiberUniformBuffer);
    this.nucleusBindGroup = this._createBindGroup(uniformBGL, this.nucleusUniformBuffer);
    this.cloudBindGroup = this._createBindGroup(uniformBGL, this.cloudUniformBuffer);
    this.electronBindGroup = this._createBindGroup(uniformBGL, this.electronUniformBuffer);

    // ── Static geometry ─────────────────────────────────────────
    this._generateFiberGeometry();
    this._generateNucleusGeometry();
    this._generateCloudQuad();
    this._generateElectronGeometry();

    // Cloud instance buffer (updated each frame)
    this.maxCloudInstances = 1000000;
    this.cloudInstanceBuffer = this.device.createBuffer({
      size: this.maxCloudInstances * 4 * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this._createDepthTexture();
  }

  _createUniformBuffer(size) {
    return this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _createBindGroup(layout, buffer) {
    return this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer } }],
    });
  }

  _createDepthTexture() {
    const canvas = this.context.canvas;
    if (this.depthTexture) this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  // ── Geometry generation ─────────────────────────────────────────

  _generateFiberGeometry() {
    const vertices = [];
    const indices = [];
    const scale = 1.0;

    const nPointsPerFiber = 128;
    const tubeSegments = 6;
    const baseTubeR = scale * 0.012;
    const totalFibers = 72;

    const goldenAngle = PI * (3 - Math.sqrt(5));
    const quarkHues = [0.0, 0.33, 0.67];

    // ── Quark fibers (72 fibers, isElectron=0) ──
    for (let fi = 0; fi < totalFibers; fi++) {
      const cosTheta = 0.92 - 1.84 * (fi + 0.5) / totalFibers;
      const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
      const phi = goldenAngle * fi;

      const normPhi = ((phi % TWO_PI) + TWO_PI) % TWO_PI;
      const quarkIdx = Math.floor(normPhi * 3 / TWO_PI) % 3;
      const hue = quarkHues[quarkIdx];

      const cosHalf = Math.cos(theta / 2);
      const sinHalf = Math.sin(theta / 2);

      const baseVertexIdx = vertices.length / 9;

      for (let pi = 0; pi < nPointsPerFiber; pi++) {
        const psi = TWO_PI * pi / nPointsPerFiber;
        const fiberParam = pi / nPointsPerFiber;

        for (let si = 0; si < tubeSegments; si++) {
          const tubeAngle = TWO_PI * si / tubeSegments;

          // 9 floats: fiberParams(3) + tubeParams(3) + hue(1) + isElectron(1) + fiberParam(1)
          vertices.push(
            cosHalf, sinHalf, phi,
            psi, tubeAngle, baseTubeR,
            hue, 0.0, fiberParam
          );
        }

        const nextPi = (pi + 1) % nPointsPerFiber;
        const ringA = baseVertexIdx + pi * tubeSegments;
        const ringB = baseVertexIdx + nextPi * tubeSegments;

        for (let si = 0; si < tubeSegments; si++) {
          const si2 = (si + 1) % tubeSegments;
          indices.push(ringA + si, ringB + si, ringA + si2);
          indices.push(ringA + si2, ringB + si, ringB + si2);
        }
      }
    }

    this.fiberVertexCount = vertices.length / 9;
    this.fiberIndexCount = indices.length;
    this.fiberVertexBuffer = this._createStaticBuffer(new Float32Array(vertices), GPUBufferUsage.VERTEX);
    this.fiberIndexBuffer = this._createStaticBuffer(new Uint32Array(indices), GPUBufferUsage.INDEX);
  }

  _generateNucleusGeometry() {
    // Single proton: 3 quarks at Z₃ triangle vertices + braid strands
    const vertices = [];
    const indices = [];
    const qR = 0.15;
    const quarkColors = [[0.9, 0.2, 0.15], [0.2, 0.8, 0.2], [0.2, 0.3, 0.9]];
    const qPositions = [];

    for (let qi = 0; qi < 3; qi++) {
      const angle = TWO_PI * qi / 3;
      const qPos = [qR * Math.cos(angle), qR * Math.sin(angle) * 0.5, qR * Math.sin(angle)];
      qPositions.push(qPos);

      const baseIdx = vertices.length / 9;
      const sphere = generateSphere(qPos, qR * 0.25, quarkColors[qi], 8);
      vertices.push(...sphere.vertices);
      for (const idx of sphere.indices) indices.push(idx + baseIdx);
    }

    // Helical braid strands
    const braidColor = [0.9, 0.75, 0.3];
    const helixR = 0.025;
    const tubeR = 0.008;
    const nHelixPts = 32;
    const nTubeSeg = 8;

    for (let qi = 0; qi < 3; qi++) {
      const p1 = qPositions[qi];
      const p2 = qPositions[(qi + 1) % 3];

      const axis = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
      const axLen = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2]);
      if (axLen < 1e-10) continue;
      axis[0] /= axLen; axis[1] /= axLen; axis[2] /= axLen;

      let up = [0, 1, 0];
      if (Math.abs(axis[1]) > 0.9) up = [1, 0, 0];
      const right = cross(axis, up);
      normalize3(right);
      const realUp = cross(right, axis);

      const helixCenters = [];
      for (let hi = 0; hi <= nHelixPts; hi++) {
        const t = hi / nHelixPts;
        const windAngle = t * TWO_PI + (qi * TWO_PI / 3);
        helixCenters.push([
          p1[0] + (p2[0]-p1[0])*t + helixR*(Math.cos(windAngle)*right[0] + Math.sin(windAngle)*realUp[0]),
          p1[1] + (p2[1]-p1[1])*t + helixR*(Math.cos(windAngle)*right[1] + Math.sin(windAngle)*realUp[1]),
          p1[2] + (p2[2]-p1[2])*t + helixR*(Math.cos(windAngle)*right[2] + Math.sin(windAngle)*realUp[2]),
        ]);
      }

      const helixBaseIdx = vertices.length / 9;
      let prevHN = null;
      for (let hi = 0; hi < nHelixPts; hi++) {
        const pc = helixCenters[hi];
        const pcNext = helixCenters[Math.min(hi+1, nHelixPts)];
        const pcPrev = helixCenters[Math.max(hi-1, 0)];

        const hT = [pcNext[0]-pcPrev[0], pcNext[1]-pcPrev[1], pcNext[2]-pcPrev[2]];
        const htLen = Math.sqrt(hT[0]*hT[0]+hT[1]*hT[1]+hT[2]*hT[2]) || 1e-6;
        hT[0] /= htLen; hT[1] /= htLen; hT[2] /= htLen;

        let hN;
        if (prevHN === null) {
          let hUp = [0, 1, 0];
          if (Math.abs(hT[1]) > 0.9) hUp = [1, 0, 0];
          hN = cross(hT, hUp);
          normalize3(hN);
        } else {
          const d = prevHN[0]*hT[0]+prevHN[1]*hT[1]+prevHN[2]*hT[2];
          hN = [prevHN[0]-d*hT[0], prevHN[1]-d*hT[1], prevHN[2]-d*hT[2]];
          const nl = Math.sqrt(hN[0]*hN[0]+hN[1]*hN[1]+hN[2]*hN[2]);
          if (nl > 1e-6) { hN[0] /= nl; hN[1] /= nl; hN[2] /= nl; }
          else { hN = cross(hT, [0,1,0]); normalize3(hN); }
        }
        const hB = cross(hT, hN);
        normalize3(hB);
        prevHN = hN;

        for (let si = 0; si < nTubeSeg; si++) {
          const a = TWO_PI * si / nTubeSeg;
          const ca = Math.cos(a), sa = Math.sin(a);
          const nx = ca*hN[0]+sa*hB[0], ny = ca*hN[1]+sa*hB[1], nz = ca*hN[2]+sa*hB[2];
          vertices.push(
            pc[0]+tubeR*nx, pc[1]+tubeR*ny, pc[2]+tubeR*nz,
            nx, ny, nz,
            braidColor[0], braidColor[1], braidColor[2],
          );
        }

        if (hi < nHelixPts - 1) {
          const rA = helixBaseIdx + hi * nTubeSeg;
          const rB = helixBaseIdx + (hi+1) * nTubeSeg;
          for (let si = 0; si < nTubeSeg; si++) {
            const si2 = (si+1) % nTubeSeg;
            indices.push(rA+si, rB+si, rA+si2);
            indices.push(rA+si2, rB+si, rB+si2);
          }
        }
      }
    }

    this.nucleusVertexCount = vertices.length / 9;
    this.nucleusIndexCount = indices.length;
    this.nucleusVertexBuffer = this._createStaticBuffer(new Float32Array(vertices), GPUBufferUsage.VERTEX);
    this.nucleusIndexBuffer = this._createStaticBuffer(new Uint32Array(indices), GPUBufferUsage.INDEX);
  }

  _generateCloudQuad() {
    // 4 vertices forming a billboard quad (−1..1)
    const quadVerts = new Float32Array([
      -1, -1,
       1, -1,
       1,  1,
      -1,  1,
    ]);
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    this.cloudQuadBuffer = this._createStaticBuffer(quadVerts, GPUBufferUsage.VERTEX);
    this.cloudQuadIndexBuffer = this._createStaticBuffer(quadIndices, GPUBufferUsage.INDEX);
  }

  _generateElectronGeometry() {
    // Unit sphere at origin — higher resolution for smooth energy ball
    const segments = 24;
    const vertices = [];
    const indices = [];

    for (let iT = 0; iT <= segments; iT++) {
      const theta = PI * iT / segments;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      for (let iP = 0; iP <= segments * 2; iP++) {
        const phi = TWO_PI * iP / (segments * 2);
        const nx = sinT * Math.cos(phi);
        const ny = cosT;
        const nz = sinT * Math.sin(phi);

        // 6 floats: position(3) + normal(3) — position = normal for unit sphere
        vertices.push(nx, ny, nz, nx, ny, nz);

        if (iT < segments && iP < segments * 2) {
          const cols = segments * 2 + 1;
          const v00 = iT * cols + iP;
          const v01 = v00 + 1;
          const v10 = v00 + cols;
          const v11 = v10 + 1;
          indices.push(v00, v10, v01);
          indices.push(v01, v10, v11);
        }
      }
    }

    this.electronVertexBuffer = this._createStaticBuffer(new Float32Array(vertices), GPUBufferUsage.VERTEX);
    this.electronIndexBuffer = this._createStaticBuffer(new Uint32Array(indices), GPUBufferUsage.INDEX);
    this.electronIndexCount = indices.length;
  }

  _createStaticBuffer(data, usage) {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    const mapped = buffer.getMappedRange();
    if (data instanceof Float32Array) {
      new Float32Array(mapped).set(data);
    } else if (data instanceof Uint32Array) {
      new Uint32Array(mapped).set(data);
    } else {
      new Uint16Array(mapped).set(data);
    }
    buffer.unmap();
    return buffer;
  }

  // ── Frame rendering ─────────────────────────────────────────────

  frame(dt, physics) {
    this.time += dt;

    const canvas = this.context.canvas;
    if (canvas.width !== canvas.clientWidth * devicePixelRatio ||
        canvas.height !== canvas.clientHeight * devicePixelRatio) {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      this._createDepthTexture();
    }

    const view = this.camera.viewMatrix();
    const proj = this.camera.projMatrix();
    const eye = this.camera.eyePosition();

    // Upload cloud instance data (clamp to GPU buffer capacity)
    let cloudInstanceCount = 0;
    if (this.showCloud && physics.count > 0) {
      cloudInstanceCount = Math.min(physics.count, this.maxCloudInstances);
      const byteSize = cloudInstanceCount * 4 * 4;
      this.device.queue.writeBuffer(
        this.cloudInstanceBuffer, 0,
        physics.points.buffer, 0,
        byteSize
      );
    }

    // ── Update uniforms ───────────────────────────────────────
    // Fiber uniforms (48 floats) — includes electron fiber
    {
      const data = new Float32Array(48);
      data.set(view, 0);
      data.set(proj, 16);
      data[32] = eye[0]; data[33] = eye[1]; data[34] = eye[2];
      data[35] = physics.time;
      data[36] = 1.0;                                    // fiberScale
      data[37] = (physics.time * 0.3) % 1.0;            // electronPhase (animated)
      data[38] = 1.0;                                    // hopfSpeed
      data[39] = 0;                                      // pad
      data[40] = this.freqs[0];                          // w1
      data[41] = this.freqs[1];                          // w2
      data[42] = this.freqs[2];                          // w3
      data[43] = this.freqs[3];                          // w4
      this.device.queue.writeBuffer(this.fiberUniformBuffer, 0, data);
    }

    // Nucleus uniforms
    {
      const data = new Float32Array(40);
      data.set(view, 0);
      data.set(proj, 16);
      data[32] = eye[0]; data[33] = eye[1]; data[34] = eye[2];
      data[35] = this.time;
      data[36] = 0.05;  // nucleusScale
      this.device.queue.writeBuffer(this.nucleusUniformBuffer, 0, data);
    }

    // Cloud uniforms
    {
      const data = new Float32Array(40);
      data.set(view, 0);
      data.set(proj, 16);
      data[32] = eye[0]; data[33] = eye[1]; data[34] = eye[2];
      data[35] = 0.03;   // pointSize
      data[36] = physics.maxWeight || 1.0;  // maxWeight for normalization
      this.device.queue.writeBuffer(this.cloudUniformBuffer, 0, data);
    }

    // Electron uniforms — sphere follows composed quark rotation
    const ePos = physics.electronPosition();
    {
      const data = new Float32Array(48);
      data.set(view, 0);
      data.set(proj, 16);
      data[32] = eye[0]; data[33] = eye[1]; data[34] = eye[2];
      data[35] = physics.time;
      data[36] = ePos[0]; data[37] = ePos[1]; data[38] = ePos[2];
      data[39] = 0.25;   // radius
      data[40] = physics.electronWeight() / (physics.maxWeight || 1.0); // normalized opacity
      this.device.queue.writeBuffer(this.electronUniformBuffer, 0, data);
    }

    // ── Render pass ───────────────────────────────────────────
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.03, g: 0.03, b: 0.06, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. Cloud (additive, no depth write) — render first so fibers show through
    if (this.showCloud && cloudInstanceCount > 0) {
      renderPass.setPipeline(this.cloudPipeline);
      renderPass.setBindGroup(0, this.cloudBindGroup);
      renderPass.setVertexBuffer(0, this.cloudQuadBuffer);
      renderPass.setVertexBuffer(1, this.cloudInstanceBuffer);
      renderPass.setIndexBuffer(this.cloudQuadIndexBuffer, 'uint16');
      renderPass.drawIndexed(6, cloudInstanceCount);
    }

    // 2. Fibers + electron (alpha blend, single draw call)
    if (this.showFibers && this.fiberIndexCount > 0) {
      renderPass.setPipeline(this.fiberPipeline);
      renderPass.setBindGroup(0, this.fiberBindGroup);
      renderPass.setVertexBuffer(0, this.fiberVertexBuffer);
      renderPass.setIndexBuffer(this.fiberIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.fiberIndexCount);
    }

    // 3. Nucleus (opaque)
    if (this.showNucleus && this.nucleusIndexCount > 0) {
      renderPass.setPipeline(this.nucleusPipeline);
      renderPass.setBindGroup(0, this.nucleusBindGroup);
      renderPass.setVertexBuffer(0, this.nucleusVertexBuffer);
      renderPass.setIndexBuffer(this.nucleusIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.nucleusIndexCount);
    }

    // 4. Electron sphere (opaque white sphere at electron position)
    if (this.showElectron && this.electronIndexCount > 0) {
      renderPass.setPipeline(this.electronPipeline);
      renderPass.setBindGroup(0, this.electronBindGroup);
      renderPass.setVertexBuffer(0, this.electronVertexBuffer);
      renderPass.setIndexBuffer(this.electronIndexBuffer, 'uint32');
      renderPass.drawIndexed(this.electronIndexCount);
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}

// ── Geometry helpers ────────────────────────────────────────────────

function generateSphere(center, radius, color, segments) {
  const vertices = [];
  const indices = [];

  for (let iT = 0; iT <= segments; iT++) {
    const theta = PI * iT / segments;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let iP = 0; iP <= segments * 2; iP++) {
      const phi = TWO_PI * iP / (segments * 2);
      const nx = sinT * Math.cos(phi);
      const ny = cosT;
      const nz = sinT * Math.sin(phi);

      vertices.push(
        center[0] + radius * nx,
        center[1] + radius * ny,
        center[2] + radius * nz,
        nx, ny, nz,
        color[0], color[1], color[2],
      );

      if (iT < segments && iP < segments * 2) {
        const cols = segments * 2 + 1;
        const v00 = iT * cols + iP;
        const v01 = v00 + 1;
        const v10 = v00 + cols;
        const v11 = v10 + 1;
        indices.push(v00, v10, v01);
        indices.push(v01, v10, v11);
      }
    }
  }

  return { vertices, indices };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len > 1e-10) { v[0] /= len; v[1] /= len; v[2] /= len; }
}
