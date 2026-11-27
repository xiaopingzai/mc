// 末地地形噪声：26.2 原版 NoiseRouterData.end() / DensityFunctions$EndIslandDensityFunction
// / synth.BlendedNoise / synth.PerlinNoise / synth.ImprovedNoise / synth.SimplexNoise 的逐行复刻。
// 原版末地最终密度 = squeeze( 0.64 * slideEnd( endIslands(x/8,z/8) + base3dNoise(x,y,z) ) )，
// 密度 > 0 即实心（end_stone）。所有随机都由固定种子派生，因此每台机器的末地形状一致。
const ENDNOISE = (function () {
  const U64 = 1n << 64n;
  const U48 = 1n << 48n;
  const u64 = (x) => { x %= U64; return x < 0n ? x + U64 : x; };
  const as64 = (x) => BigInt.asIntN(64, x);
  const rotl = (x, n) => { n %= 64; if (n === 0) return u64(x); const b = BigInt(n); return u64((x << b) | (x >> BigInt(64 - n))); };

  // ---------- Xoroshiro128++（26.2 世界地形随机源） ----------
  function Xoroshiro(lo, hi) {
    this.lo = u64(lo); this.hi = u64(hi);
    if ((this.lo | this.hi) === 0n) { this.lo = u64(-7046029254386353131n); this.hi = u64(7640891576956012809n); }
  }
  Xoroshiro.prototype.next = function () {
    const s0 = this.lo, s1 = this.hi;
    const res = u64(rotl(u64(s0 + s1), 17) + s0);
    const x = u64(s1 ^ s0);
    this.lo = u64(rotl(s0, 49) ^ x ^ u64(x << 21n));
    this.hi = rotl(x, 28);
    return res;
  };
  function mixStafford13(z) {
    z = u64(u64(z ^ (z >> 30n)) * u64(-4658895280553007687n));
    z = u64(u64(z ^ (z >> 27n)) * u64(-7723592293110705685n));
    return u64(z ^ (z >> 31n));
  }
  function XoroSource(seed) {
    // RandomSupport.upgradeSeedTo128bit(seed) = unmixed(seed).mixed()
    const lo0 = u64(BigInt(seed) ^ 0x6A09E667F3BCC909n);
    const hi0 = u64(lo0 + u64(-7046029254386353131n));
    this.gen = new Xoroshiro(mixStafford13(lo0), mixStafford13(hi0));
  }
  XoroSource.prototype.nextLong = function () { return this.gen.next(); };
  XoroSource.prototype.nextBits = function (bits) { return Number(this.gen.next() >> BigInt(64 - bits)); };
  XoroSource.prototype.nextDouble = function () { return this.nextBits(53) * 1.110223e-16; };
  XoroSource.prototype.nextInt = function () { return Number(as64(this.gen.next())); };
  XoroSource.prototype.nextIntB = function (bound) {
    const B = BigInt(bound);
    let bits = this.gen.next() & 0xFFFFFFFFn;
    let mult = bits * B;
    let frac = mult & 0xFFFFFFFFn;
    if (frac < B) {
      const ub = ((0x100000000n - B) % B);
      while (frac < ub) {
        bits = this.gen.next() & 0xFFFFFFFFn;
        mult = bits * B;
        frac = mult & 0xFFFFFFFFn;
      }
    }
    return Number(mult >> 32n);
  };

  // ---------- LegacyRandomSource（34 年前的线性同余，末地岛噪声专用） ----------
  function Legacy(seed) {
    this.s = u64((BigInt(seed) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn);
  }
  Legacy.prototype.next = function (bits) {
    this.s = (this.s * 25214903917n + 11n) & 0xFFFFFFFFFFFFn;
    return Number(this.s >> BigInt(48 - bits));
  };
  Legacy.prototype.nextDouble = function () { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; };
  Legacy.prototype.nextIntB = function (bound) {
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let i, j;
    do { i = this.next(31); j = i % bound; } while (i - j + (bound - 1) < 0);
    return j;
  };
  Legacy.prototype.consume = function (n) { for (let i = 0; i < n; i++) this.next(32); };

  // ---------- SimplexNoise（末地岛 2D 噪声） ----------
  const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]];
  const SQRT3 = Math.sqrt(3), F2 = 0.5 * (SQRT3 - 1), G2 = (3 - SQRT3) / 6;
  function Simplex(rng) {
    this.xo = rng.nextDouble() * 256; this.yo = rng.nextDouble() * 256; this.zo = rng.nextDouble() * 256;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const o = rng.nextIntB(256 - i);
      const t = p[i]; p[i] = p[i + o]; p[i + o] = t;
    }
    this.p = p;
  }
  Simplex.prototype.pf = function (x) { return this.p[x & 0xFF]; };
  function corner2(idx, x, y, base) {
    let t = base - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD[idx];
    return t * t * (g[0] * x + g[1] * y);
  }
  Simplex.prototype.get2 = function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 0xFF, jj = j & 0xFF;
    const gi0 = this.pf(ii + this.pf(jj)) % 12;
    const gi1 = this.pf(ii + i1 + this.pf(jj + j1)) % 12;
    const gi2 = this.pf(ii + 1 + this.pf(jj + 1)) % 12;
    return 70 * (corner2(gi0, x0, y0, 0.5) + corner2(gi1, x1, y1, 0.5) + corner2(gi2, x2, y2, 0.5));
  };

  // ---------- ImprovedNoise（Perlin 单层） ----------
  function ImprovedNoise(rng) {
    this.xo = rng.nextDouble() * 256; this.yo = rng.nextDouble() * 256; this.zo = rng.nextDouble() * 256;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const o = rng.nextIntB(256 - i);
      const t = p[i]; p[i] = p[i + o]; p[i + o] = t;
    }
    this.p = p;
  }
  ImprovedNoise.prototype.pf = function (x) { return this.p[x & 0xFF]; };
  const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);
  const lerp3 = (a, b, c, d000, d100, d010, d110, d001, d101, d011, d111) => {
    const x00 = d000 + a * (d100 - d000), x01 = d001 + a * (d101 - d001);
    const x10 = d010 + a * (d110 - d010), x11 = d011 + a * (d111 - d011);
    const z0 = x00 + c * (x01 - x00), z1 = x10 + c * (x11 - x10);
    return z0 + b * (z1 - z0);
  };
  ImprovedNoise.prototype.noise = function (_x, _y, _z, yScale, yFudge) {
    const x = _x + this.xo, y = _y + this.yo, z = _z + this.zo;
    const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
    const xr = x - xf, yr = y - yf, zr = z - zf;
    let yrF = 0;
    if (yScale !== 0) {
      const lim = (yFudge >= 0 && yFudge < yr) ? yFudge : yr;
      yrF = Math.floor(lim / yScale + 1e-7) * yScale;
    }
    const x0 = this.pf(xf), x1 = this.pf(xf + 1);
    const xy00 = this.pf(x0 + yf), xy01 = this.pf(x0 + yf + 1);
    const xy10 = this.pf(x1 + yf), xy11 = this.pf(x1 + yf + 1);
    const d = (h, a, b, c) => { const g = GRAD[h & 0xF]; return g[0] * a + g[1] * b + g[2] * c; };
    const d000 = d(this.pf(xy00 + zf), xr, yr - yrF, zr);
    const d100 = d(this.pf(xy10 + zf), xr - 1, yr - yrF, zr);
    const d010 = d(this.pf(xy01 + zf), xr, yr - yrF - 1, zr);
    const d110 = d(this.pf(xy11 + zf), xr - 1, yr - yrF - 1, zr);
    const d001 = d(this.pf(xy00 + zf + 1), xr, yr - yrF, zr - 1);
    const d101 = d(this.pf(xy10 + zf + 1), xr - 1, yr - yrF, zr - 1);
    const d011 = d(this.pf(xy01 + zf + 1), xr, yr - yrF - 1, zr - 1);
    const d111 = d(this.pf(xy11 + zf + 1), xr - 1, yr - yrF - 1, zr - 1);
    return lerp3(smooth(xr), smooth(yr), smooth(zr), d000, d100, d010, d110, d001, d101, d011, d111);
  };

  // ---------- PerlinNoise（旧版八度叠加） ----------
  const wrap = (x) => x - Math.floor(x / 3.3554432e7 + 0.5) * 3.3554432e7;
  function Perlin(rng, firstOctave, octaveCount) {
    // createLegacyForBlendedNoise：先建 0 号八度，然后从 -1 往更低的频率依次建
    const zeroIdx = -firstOctave;
    this.levels = new Array(octaveCount).fill(null);
    this.levels[zeroIdx] = new ImprovedNoise(rng);
    for (let i = zeroIdx - 1; i >= 0; i--) this.levels[i] = new ImprovedNoise(rng);
    this.amps = new Float64Array(octaveCount).fill(1);
    this.lowIn = Math.pow(2, -zeroIdx);
    this.lowVal = Math.pow(2, octaveCount - 1) / (Math.pow(2, octaveCount) - 1);
  }
  Perlin.prototype.octave = function (i) { return this.levels[this.levels.length - 1 - i]; };
  Perlin.prototype.value = function (x, y, z, yScale, yFudge) {
    let d = 0, e = this.lowIn, f = this.lowVal;
    for (let i = 0; i < this.levels.length; i++) {
      const n = this.levels[i];
      if (n) d += this.amps[i] * n.noise(wrap(x * e), wrap(y * e), wrap(z * e), yScale * e, yFudge * e) * f;
      e *= 2; f /= 2;
    }
    return d;
  };

  // ---------- BlendedNoise（末地底层 3D 噪声） ----------
  function Blended(rng, xzScale, yScale, xzFactor, yFactor, smear) {
    this.minL = new Perlin(rng, -15, 16);
    this.maxL = new Perlin(rng, -15, 16);
    this.main = new Perlin(rng, -7, 8);
    this.xzMul = 684.412 * xzScale;
    this.yMul = 684.412 * yScale;
    this.xzFac = xzFactor;
    this.yFac = yFactor;
    this.smear = smear;
  }
  Blended.prototype.compute = function (bx, by, bz) {
    const limitX = bx * this.xzMul, limitY = by * this.yMul, limitZ = bz * this.xzMul;
    const mainX = limitX / this.xzFac, mainY = limitY / this.yFac, mainZ = limitZ / this.xzFac;
    const limSmear = this.yMul * this.smear, mainSmear = limSmear / this.yFac;
    let bMin = 0, bMax = 0, mainVal = 0, pow = 1;
    for (let i = 0; i < 8; i++) {
      const n = this.main.octave(i);
      if (n) mainVal += n.noise(wrap(mainX * pow), wrap(mainY * pow), wrap(mainZ * pow), mainSmear * pow, mainY * pow) / pow;
      pow /= 2;
    }
    const factor = (mainVal / 10 + 1) / 2;
    const isMax = factor >= 1, isMin = factor <= 0;
    pow = 1;
    for (let i = 0; i < 16; i++) {
      const wx = wrap(limitX * pow), wy = wrap(limitY * pow), wz = wrap(limitZ * pow);
      const yp = limSmear * pow;
      const nMin = this.minL.octave(i), nMax = this.maxL.octave(i);
      if (!isMax && nMin) bMin += nMin.noise(wx, wy, wz, yp, limitY * pow) / pow;
      if (!isMin && nMax) bMax += nMax.noise(wx, wy, wz, yp, limitY * pow) / pow;
      pow /= 2;
    }
    const t = factor < 0 ? 0 : factor > 1 ? 1 : factor;
    const a = bMin / 512, b = bMax / 512;
    return (a + t * (b - a)) / 128;
  };

  // ---------- 末地岛密度：EndIslandDensityFunction ----------
  const islandRng = new Legacy(0);
  islandRng.consume(17292);
  const islandNoise = new Simplex(islandRng);
  const THRESHOLD = -0.9;
  const islCache = new Map();
  function islandHeight(sx, sz) {
    const k = sx * 100003 + sz;
    const hit = islCache.get(k);
    if (hit !== undefined) return hit;
    const v = islandHeightRaw(sx, sz);
    if (islCache.size < 262144) islCache.set(k, v);
    return v;
  }
  function islandHeightRaw(sx, sz) {
    const cx = Math.trunc(sx / 2), cz = Math.trunc(sz / 2);
    const subX = sx % 2, subZ = sz % 2;
    let doffs = 100 - Math.sqrt(sx * sx + sz * sz) * 8;
    doffs = Math.max(-100, Math.min(80, doffs));
    for (let xo = -12; xo <= 12; xo++) {
      for (let zo = -12; zo <= 12; zo++) {
        const tc = cx + xo, tcz = cz + zo;
        if (tc * tc + tcz * tcz <= 4096 || islandNoise.get2(tc, tcz) >= THRESHOLD) continue;
        const size = (Math.abs(tc) * 3439 + Math.abs(tcz) * 147) % 13 + 9;
        const xd = subX - xo * 2, zd = subZ - zo * 2;
        let nd = 100 - Math.sqrt(xd * xd + zd * zd) * size;
        nd = Math.max(-100, Math.min(80, nd));
        if (nd > doffs) doffs = nd;
      }
    }
    return doffs;
  }

  // 26.2：BASE_3D_NOISE_END = BlendedNoise.createUnseeded(0.25, 0.25, 80.0, 160.0, 4.0)
  const baseRng = new XoroSource(0);
  const base = new Blended(baseRng, 0.25, 0.25, 80, 160, 4);

  // slideEnd：slide(caves, 0, 128, 72, -184, -23.4375, 4, 32, -0.234375)
  function slideEnd(d, y) {
    let tf;
    if (y <= 56) tf = 1; else if (y >= 312) tf = 0; else tf = 1 - (y - 56) / 256;
    d = -23.4375 + tf * (d + 23.4375);
    let bf;
    if (y <= 4) bf = 0; else if (y >= 32) bf = 1; else bf = (y - 4) / 28;
    d = -0.234375 + bf * (d + 0.234375);
    return d;
  }
  // postProcess：乘以 0.64 再 squeeze
  function squeeze(d) {
    const c = d < -1 ? -1 : d > 1 ? 1 : d;
    return c / 2 - c * c * c / 24;
  }
  // 世界坐标 → 密度值（>0 是实心 end_stone）
  function density(x, y, z) {
    const sx = Math.trunc(x / 8), sz = Math.trunc(z / 8);
    const sloped = (islandHeight(sx, sz) - 8) / 128 + base.compute(x, y, z);
    return squeeze(slideEnd(sloped, y) * 0.64);
  }
  // 每列的最高/最低实心方块（用于快速生成）：先按 8 格稀疏扫描，再在命中段内逐个细化
  const colCache = new Map();
  function columnRaw(x, z, yMin, yMax) {
    let top = null;
    for (let y = yMax; y >= yMin; y -= 8) {
      if (density(x, y, z) > 0) { top = y; break; }
    }
    if (top === null) return null;
    for (let y = Math.min(yMax, top + 8); y > top; y--) { if (density(x, y, z) > 0) { top = y; break; } }
    let bot = yMin;
    for (let y = top; y >= yMin; y -= 8) {
      if (density(x, y, z) <= 0) { bot = y + 1; break; }
    }
    for (let y = bot; y <= top; y++) { if (density(x, y, z) > 0) { bot = y; break; } }
    if (bot > top) bot = top;
    return { top, bot };
  }
  function column(x, z, yMin, yMax) {
    const k = x * 100003 + z;
    const hit = colCache.get(k);
    if (hit !== undefined) return hit;
    const v = columnRaw(x, z, yMin, yMax);
    if (colCache.size < 200000) colCache.set(k, v);
    return v;
  }
  return { density, column, islandHeight, base };
})();
if (typeof module !== 'undefined') module.exports = ENDNOISE;
