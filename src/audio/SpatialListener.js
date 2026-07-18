/**
 * Listener pose + short-lived HRTF panners for world SFX / remote engines.
 */

export class SpatialListener {
  constructor(hub) {
    this.hub = hub;
  }

  setListener(x, y, z, fx, fy, fz) {
    const ctx = this.hub.ctx;
    if (!ctx?.listener) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /**
   * Create a panner connected to a bus. Caller must connect sources into it.
   * @param {string} busName
   * @param {{x:number,y:number,z:number, refDistance?:number, maxDistance?:number}} opts
   */
  createPanner(busName, opts = {}) {
    const ctx = this.hub.ensure();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = opts.refDistance ?? 12;
    panner.maxDistance = opts.maxDistance ?? 500;
    panner.rolloffFactor = opts.rolloffFactor ?? 1.1;
    this.setPannerPosition(panner, opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
    panner.connect(this.hub.bus(busName));
    return panner;
  }

  setPannerPosition(panner, x, y, z) {
    if (!panner) return;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else if (panner.setPosition) {
      panner.setPosition(x, y, z);
    }
  }
}
