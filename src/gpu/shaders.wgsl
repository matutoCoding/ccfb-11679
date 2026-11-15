// WGSL 光路追踪着色器。折射与求交逻辑与 src/core 的 CPU 参考实现逐行同构,
// 共用同一套水折射率系数, 保证"所见即所算"。
//
// 统一场景约定(米):
//   平面缸 planar: 面板 z=0, 亚克力 z∈[-t,0], 水在 z<-t, 游客在 +z
//   圆柱缸 cylinder: 轴沿 y, 外壁 R, 内壁 R-t, 水在内部, 游客在外
//   隧道拱 tunnel: 轴沿 x 的半圆柱, 游客在内部水中, 经内壁→外壁看向空气

// ---------- 水折射率(与 waterIor.ts 同系数同运算顺序) ----------
fn waterIor(tempC: f32) -> f32 {
  let T = clamp(tempC, 0.0, 60.0);
  let c0 = 1.3335153;
  let c1 = 3.29440948e-5;
  let c2 = -2.17948135e-6;
  let c3 = 6.6540404e-9;
  return c0 + c1 * T + c2 * T * T + c3 * T * T * T;
}

// ---------- 矢量折射(与 optics.ts refract 同构) ----------
// 法线自动翻到顺光侧(I·n>0); eta=n_from/n_to; 全反射返回 refOk=false
fn refractDir(I: vec3<f32>, N: vec3<f32>, eta: f32) -> vec4<f32> {
  var n = N;
  if (dot(I, n) < 0.0) { n = -n; }
  let cosi = dot(I, n);
  let sin2t = eta * eta * (1.0 - cosi * cosi);
  if (sin2t > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0); // xyz 方向, w=0 表示全反射
  }
  let k = sqrt(1.0 - sin2t) - eta * cosi;
  let T = normalize(eta * I + k * n);
  return vec4<f32>(T, 1.0);
}

struct Uniforms {
  camPos: vec3<f32>,
  _p0: f32,
  camTarget: vec3<f32>,
  _p1: f32,
  camRight: vec3<f32>,
  fovY: f32,
  camUp: vec3<f32>,
  aspect: f32,
  // 缸体几何
  kind: f32,        // 0 planar, 1 cylinder, 2 tunnel
  thickness: f32,
  radius: f32,
  depth: f32,
  // 光学
  iorAir: f32,
  iorAcrylic: f32,
  waterTemp: f32,
  waterOverride: f32, // <0 表示用温度
  // 渲染
  time: f32,
  exposure: f32,
  showGrid: f32,
  debugRay: f32,
  animateFish: f32,
  resolutionScale: f32,
  fishCount: f32,
  rockCount: f32,
  gridDensity: f32,
  refDistance: f32,
  viewportW: f32,
  viewportH: f32,
  // 实际生效的水折射率(由 JS 端温度计算后传入) + 对齐填充
  nWater: f32,
  _padTail: f32,
};

// 内存布局与 JS packFish/packRock 严格一致: 每个 vec3 后补 1 个 f32, 每项 48 字节
struct Fish {
  center: vec3<f32>,
  _f0: f32,
  color: vec3<f32>,
  _f1: f32,
  swimRadius: f32,
  swimSpeed: f32,
  fishLength: f32,
  count: f32,
};

struct Rock {
  center: vec3<f32>,
  _r0: f32,
  color: vec3<f32>,
  _r1: f32,
  scale: vec3<f32>,
  _r2: f32,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> fishes: array<Fish>;
@group(0) @binding(2) var<storage, read> rocks: array<Rock>;

struct Hit {
  t: f32,
  normal: vec3<f32>,
  hit: bool,
};

const NO_HIT: Hit = Hit(1e30, vec3<f32>(0.0, 0.0, 1.0), false);
const EPS: f32 = 1e-9;

// ---------- 平面求交: dot(p,N)=d ----------
fn hitPlane(ro: vec3<f32>, rd: vec3<f32>, N: vec3<f32>, d: f32) -> Hit {
  let denom = dot(rd, N);
  if (abs(denom) < 1e-12) { return NO_HIT; }
  let tt = (d - dot(ro, N)) / denom;
  if (tt <= EPS) { return NO_HIT; }
  return Hit(tt, N, true);
}

// ---------- 轴沿 y 的圆柱: x²+z²=r² ----------
fn hitCylinder(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> Hit {
  let a = rd.x * rd.x + rd.z * rd.z;
  if (a < 1e-15) { return NO_HIT; }
  let b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
  let c = ro.x * ro.x + ro.z * ro.z - r * r;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) { return NO_HIT; }
  let sq = sqrt(disc);
  var tt = (-b - sq) / (2.0 * a);
  if (tt <= EPS) { tt = (-b + sq) / (2.0 * a); }
  if (tt <= EPS) { return NO_HIT; }
  let p = ro + rd * tt;
  return Hit(tt, normalize(vec3<f32>(p.x, 0.0, p.z)), true);
}

// ---------- 隧道拱: 轴沿 x 半圆柱 y²+z²=r², 仅 y>=0 ----------
fn hitTunnel(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> Hit {
  let a = rd.y * rd.y + rd.z * rd.z;
  if (a < 1e-15) { return NO_HIT; }
  let b = 2.0 * (ro.y * rd.y + ro.z * rd.z);
  let c = ro.y * ro.y + ro.z * ro.z - r * r;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) { return NO_HIT; }
  let sq = sqrt(disc);
  let t1 = (-b - sq) / (2.0 * a);
  let t2 = (-b + sq) / (2.0 * a);
  var candidates = array<f32, 2>(t1, t2);
  for (var i = 0; i < 2; i = i + 1) {
    let tt = candidates[i];
    if (tt <= EPS) { continue; }
    let p = ro + rd * tt;
    if (p.y < -EPS) { continue; }
    return Hit(tt, normalize(vec3<f32>(0.0, p.y, p.z)), true);
  }
  return NO_HIT;
}

// 按缸体类型求某半径/深度的壁面
fn hitWall(ro: vec3<f32>, rd: vec3<f32>, r: f32, planeD: f32) -> Hit {
  if (U.kind < 0.5) {
    return hitPlane(ro, rd, vec3<f32>(0.0, 0.0, 1.0), planeD);
  } else if (U.kind < 1.5) {
    return hitCylinder(ro, rd, r);
  } else {
    return hitTunnel(ro, rd, r);
  }
}

// ---------- 球(鱼/礁石的椭球用非均匀缩放近似) ----------
fn hitEllipsoid(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, rad: vec3<f32>) -> Hit {
  // 变换到单位球空间
  let o = (ro - center) / rad;
  let d = rd / rad;
  let a = dot(d, d);
  let b = 2.0 * dot(o, d);
  let c = dot(o, o) - 1.0;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) { return NO_HIT; }
  let sq = sqrt(disc);
  var tt = (-b - sq) / (2.0 * a);
  if (tt <= EPS) { tt = (-b + sq) / (2.0 * a); }
  if (tt <= EPS) { return NO_HIT; }
  // 单位球交点映射回世界法线
  let localP = o + d * tt;
  let nWorld = normalize(localP / rad);
  return Hit(tt, nWorld, true);
}

// 背景参考网格: 平面上的网格着色强度
fn gridFactor(p: vec3<f32>, density: f32) -> f32 {
  let gx = abs(fract(p.x * density) - 0.5);
  let gy = abs(fract(p.y * density) - 0.5);
  let line = min(gx, gy);
  return 1.0 - smoothstep(0.0, 0.06, line);
}

// 简易哈希, 用于鱼群个体相位
fn hash1(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  // 全屏三角形
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

struct Ray { ro: vec3<f32>, rd: vec3<f32> };

// 追踪缸壁两次折射, 返回进入水体(或隧道中进入空气)后的光线
struct WallResult {
  ray: Ray,
  ok: bool,
  tir: bool,
};

fn traceWalls(roIn: vec3<f32>, rdIn: vec3<f32>, nWater: f32) -> WallResult {
  let t = U.thickness;
  let outsideIn = U.kind < 1.5; // planar/cylinder 游客在外; tunnel 在内
  var ro = roIn;
  var rd = rdIn;
  var ok = true;
  var tir = false;

  if (outsideIn) {
    // 外壁(空气→亚克力), 内壁(亚克力→水)
    let h1 = hitWall(ro, rd, U.radius, 0.0);
    if (!h1.hit) { ok = false; }
    if (ok) {
      let r1 = refractDir(rd, h1.normal, U.iorAir / U.iorAcrylic);
      if (r1.w < 0.5) { tir = true; ok = false; }
      if (ok) {
        ro = ro + rd * h1.t;
        rd = r1.xyz;
        let h2 = hitWall(ro, rd, U.radius - t, -t);
        if (!h2.hit) { ok = false; }
        if (ok) {
          let r2 = refractDir(rd, h2.normal, U.iorAcrylic / nWater);
          if (r2.w < 0.5) { tir = true; ok = false; }
          if (ok) {
            ro = ro + rd * h2.t;
            rd = r2.xyz;
          }
        }
      }
    }
  } else {
    // 隧道 insideOut: 内壁(水→亚克力), 外壁(亚克力→空气)
    let h1 = hitWall(ro, rd, U.radius - t, -t);
    if (!h1.hit) { ok = false; }
    if (ok) {
      let r1 = refractDir(rd, h1.normal, nWater / U.iorAcrylic);
      if (r1.w < 0.5) { tir = true; ok = false; }
      if (ok) {
        ro = ro + rd * h1.t;
        rd = r1.xyz;
        let h2 = hitWall(ro, rd, U.radius, 0.0);
        if (!h2.hit) { ok = false; }
        if (ok) {
          let r2 = refractDir(rd, h2.normal, U.iorAcrylic / U.iorAir);
          if (r2.w < 0.5) { tir = true; ok = false; }
          if (ok) {
            ro = ro + rd * h2.t;
            rd = r2.xyz;
          }
        }
      }
    }
  }
  return WallResult(Ray(ro, rd), ok, tir);
}

// 水中场景着色(鱼群、礁石、背景网格、水体雾效)
fn shadeWater(ray: Ray, nWater: f32) -> vec3<f32> {
  var col = vec3<f32>(0.02, 0.10, 0.16); // 深水底色
  var bestT = 1e30;
  var hitColor = vec3<f32>(0.0);
  var didHit = false;

  // 鱼群(每个 school 用代表椭球 + 相位散布)
  let nFish = arrayLength(&fishes);
  for (var i = 0u; i < nFish; i = i + 1u) {
    let f = fishes[i];
    let phase = U.time * f.swimSpeed * 6.2831853;
    // 用若干离散个体近似鱼群, 环形巡游
    let instances = min(f.count, 12.0);
    for (var k = 0; k < 12; k = k + 1) {
      if (f32(k) >= instances) { break; }
      let ang = phase + f32(k) * 6.2831853 / instances + hash1(f32(k) + f.count) * 0.5;
      let wob = (hash1(f32(k) * 3.1) - 0.5) * 0.4;
      let pos = f.center + vec3<f32>(
        cos(ang) * f.swimRadius,
        wob,
        sin(ang) * f.swimRadius);
      let h = hitEllipsoid(ray.ro, ray.rd, pos, vec3<f32>(f.fishLength * 0.5, f.fishLength * 0.18, f.fishLength * 0.18));
      if (h.hit && h.t < bestT) {
        bestT = h.t;
        hitColor = f.color * (0.6 + 0.4 * max(0.0, h.normal.y));
        didHit = true;
      }
    }
  }

  // 礁石
  let nRock = arrayLength(&rocks);
  for (var i = 0u; i < nRock; i = i + 1u) {
    let rk = rocks[i];
    let h = hitEllipsoid(ray.ro, ray.rd, rk.center, rk.scale);
    if (h.hit && h.t < bestT) {
      bestT = h.t;
      let lam = 0.5 + 0.5 * max(0.0, h.normal.y);
      hitColor = rk.color * lam;
      didHit = true;
    }
  }

  // 背景参考网格平面(缸体后方 refDistance 处, 近似放在 z 较深处)
  if (U.showGrid > 0.5) {
    let backZ = -U.depth;
    let gh = hitPlane(ray.ro, ray.rd, vec3<f32>(0.0, 0.0, 1.0), backZ);
    if (gh.hit && gh.t < bestT) {
      let gp = ray.ro + ray.rd * gh.t;
      let g = gridFactor(gp, U.gridDensity);
      hitColor = mix(vec3<f32>(0.75, 0.82, 0.85), vec3<f32>(0.05, 0.12, 0.18), g);
      bestT = gh.t;
      didHit = true;
    }
  }

  if (didHit) {
    // 水体随距离的吸收/雾效(蓝绿色调)
    let fog = 1.0 - exp(-0.18 * bestT);
    col = mix(hitColor, vec3<f32>(0.03, 0.16, 0.22), fog);
  }
  return col;
}

// 隧道外(空气侧)背景: 明亮的环境光
fn shadeAir(ray: Ray) -> vec3<f32> {
  let sky = mix(vec3<f32>(0.55, 0.72, 0.92), vec3<f32>(0.85, 0.9, 0.95), ray.rd.y * 0.5 + 0.5);
  return sky;
}

@fragment
fn fsMain(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(U.viewportW, U.viewportH);
  let uv = (frag.xy / size) * 2.0 - 1.0;
  let ndc = vec2<f32>(uv.x * U.aspect, uv.y) * tan(U.fovY * 0.5 * 3.14159265 / 180.0);

  let forward = normalize(U.camTarget - U.camPos);
  let rd = normalize(forward + U.camRight * ndc.x + U.camUp * ndc.y);
  let ro = U.camPos;

  let nWater = select(waterIor(U.waterTemp), U.waterOverride, U.waterOverride > 0.0);

  let wall = traceWalls(ro, rd, nWater);

  var col: vec3<f32>;
  if (!wall.ok) {
    // 全反射或漏交: 用深色高反光提示, 并在调试模式标红
    col = select(vec3<f32>(0.08, 0.09, 0.12), vec3<f32>(0.9, 0.15, 0.1), wall.tir);
  } else if (U.kind < 1.5) {
    col = shadeWater(wall.ray, nWater);
  } else {
    col = shadeAir(wall.ray);
  }

  // 屏幕中心调试光线标记
  if (U.debugRay > 0.5) {
    let d = length(frag.xy - size * 0.5);
    if (d < 6.0) { col = vec3<f32>(1.0, 0.2, 0.2); }
  }

  // 曝光 + 简单 gamma
  col = clamp(col * U.exposure, vec3<f32>(0.0), vec3<f32>(1.0));
  col = pow(col, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(col, 1.0);
}
