// Orbit camera — spherical coordinates around origin.
// Mouse drag rotates, scroll zooms.

export class OrbitCamera {
  constructor(canvas) {
    this.canvas = canvas;
    this.azimuth = 0;
    this.elevation = 0.4;
    this.distance = 6.0;
    this.target = [0, 0, 0];

    this.fovY = Math.PI / 4;
    this.near = 0.01;
    this.far = 1000;

    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;

      this.azimuth -= dx * 0.005;
      this.elevation += dy * 0.005;
      this.elevation = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.elevation));
    });

    this.canvas.addEventListener('pointerup', () => {
      this._dragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance *= 1 + e.deltaY * 0.001;
      this.distance = Math.max(0.1, Math.min(100, this.distance));
    }, { passive: false });
  }

  eyePosition() {
    const cosEl = Math.cos(this.elevation);
    return [
      this.distance * cosEl * Math.sin(this.azimuth) + this.target[0],
      this.distance * Math.sin(this.elevation) + this.target[1],
      this.distance * cosEl * Math.cos(this.azimuth) + this.target[2],
    ];
  }

  viewMatrix() {
    const eye = this.eyePosition();
    return lookAt(eye, this.target, [0, 1, 0]);
  }

  projMatrix() {
    const aspect = this.canvas.width / this.canvas.height;
    return perspective(this.fovY, aspect, this.near, this.far);
  }
}

// Column-major matrices for WebGPU

function lookAt(eye, center, up) {
  const fx = center[0] - eye[0];
  const fy = center[1] - eye[1];
  const fz = center[2] - eye[2];
  const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
  const f = [fx / fLen, fy / fLen, fz / fLen];

  let sx = f[1] * up[2] - f[2] * up[1];
  let sy = f[2] * up[0] - f[0] * up[2];
  let sz = f[0] * up[1] - f[1] * up[0];
  const sLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
  sx /= sLen; sy /= sLen; sz /= sLen;

  const ux = sy * f[2] - sz * f[1];
  const uy = sz * f[0] - sx * f[2];
  const uz = sx * f[1] - sy * f[0];

  return new Float32Array([
    sx, ux, -f[0], 0,
    sy, uy, -f[1], 0,
    sz, uz, -f[2], 0,
    -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]),
    1,
  ]);
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
