// 畸变分析 compute shader。
// 在缸后参考平面上取 N×N 网格, 对每个节点反向求"它经缸壁折射后在游客侧的表观方向",
// 通过相邻节点的雅可比估计局部放大率, 并计算相对无墙直线的偏移量(毫米)。
// 结果写入 storage buffer, CPU 回读后可着色/导出 CSV。

struct DUniforms {
  camPos: vec3<f32>,
  gridN: f32,
  // 缸体
  kind: f32,
  thickness: f32,
  radius: f32,
  planeSpan: f32,   // 参考平面采样跨度(米)
  refDistance: f32,
  metric: f32,      // 0 offset, 1 magnification
  offsetMaxMm: f32,
  // 光学
  iorAir: f32,
  iorAcrylic: f32,
  nWater: f32,
  _pad0: f32,
  _pad1: f32,
};

struct DCell {
  offsetMm: f32,    // 偏移量(毫米)
  magnification: f32, // 局部放大率(1=无畸变)
  x: f32,
  y: f32,
};

@group(0) @binding(0) var<uniform> U: DUniforms;
@group(0) @binding(1) var<storage, read_write> outCells: array<DCell>;

fn refractD(I: vec3<f32>, N: vec3<f32>, eta: f32) -> vec4<f32> {
  var n = N;
  if (dot(I, n) < 0.0) { n = -n; }
  let cosi = dot(I, n);
  let sin2t = eta * eta * (1.0 - cosi * cosi);
  if (sin2t > 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let k = sqrt(1.0 - sin2t) - eta * cosi;
  return vec4<f32>(normalize(eta * I + k * n), 1.0);
}

fn hitPlaneD(ro: vec3<f32>, rd: vec3<f32>, d: f32) -> vec2<f32> {
  // 平面 z=d, 返回 (t, 是否命中)
  let denom = rd.z;
  if (abs(denom) < 1e-12) { return vec2<f32>(-1.0, 0.0); }
  let tt = (d - ro.z) / denom;
  return vec2<f32>(tt, select(0.0, 1.0, tt > 1e-9));
}

fn hitCylD(ro: vec3<f32>, rd: vec3<f32>, r: f32) -> vec4<f32> {
  // xyz=交点, w=t; 未命中 w<0
  let a = rd.x * rd.x + rd.z * rd.z;
  if (a < 1e-15) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let b = 2.0 * (ro.x * rd.x + ro.z * rd.z);
  let c = ro.x * ro.x + ro.z * ro.z - r * r;
  let disc = b * b - 4.0 * a * c;
  if (disc < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let sq = sqrt(disc);
  var tt = (-b - sq) / (2.0 * a);
  if (tt <= 1e-9) { tt = (-b + sq) / (2.0 * a); }
  if (tt <= 1e-9) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
  let p = ro + rd * tt;
  return vec4<f32>(p, tt);
}

// 从水中参考点出发, 反向穿过缸壁到空气。
// 返回 vec4: xyz=出外壁后的方向, w=状态(1 成功, 0 失败); 出射点通过 outExit 输出。
fn reverseTrace(wp: vec3<f32>, dir: vec3<f32>, outExit: ptr<function, vec3<f32>>) -> vec4<f32> {
  var ro = wp;
  if (U.kind < 0.5) {
    // 平面: 先内壁 z=-t (水→亚克力), 再外壁 z=0 (亚克力→空气)
    let h1 = hitPlaneD(ro, dir, -U.thickness);
    if (h1.y < 0.5) { return vec4<f32>(0.0); }
    let p1 = ro + dir * h1.x;
    let r1 = refractD(dir, vec3<f32>(0.0, 0.0, 1.0), U.nWater / U.iorAcrylic);
    if (r1.w < 0.5) { return vec4<f32>(0.0); }
    let h2 = hitPlaneD(p1, r1.xyz, 0.0);
    if (h2.y < 0.5) { return vec4<f32>(0.0); }
    let p2 = p1 + r1.xyz * h2.x;
    let r2 = refractD(r1.xyz, vec3<f32>(0.0, 0.0, 1.0), U.iorAcrylic / U.iorAir);
    if (r2.w < 0.5) { return vec4<f32>(0.0); }
    *outExit = p2;
    return vec4<f32>(r2.xyz, 1.0);
  } else {
    // 圆柱: 内壁 R-t 再外壁 R, 法线径向
    let h1 = hitCylD(ro, dir, U.radius - U.thickness);
    if (h1.w < 0.0) { return vec4<f32>(0.0); }
    let n1 = normalize(vec3<f32>(h1.x, 0.0, h1.z));
    let r1 = refractD(dir, n1, U.nWater / U.iorAcrylic);
    if (r1.w < 0.5) { return vec4<f32>(0.0); }
    let p1 = h1.xyz;
    let h2 = hitCylD(p1, r1.xyz, U.radius);
    if (h2.w < 0.0) { return vec4<f32>(0.0); }
    let n2 = normalize(vec3<f32>(h2.x, 0.0, h2.z));
    let r2 = refractD(r1.xyz, n2, U.iorAcrylic / U.iorAir);
    if (r2.w < 0.5) { return vec4<f32>(0.0); }
    *outExit = h2.xyz;
    return vec4<f32>(r2.xyz, 1.0);
  }
}

// 出射光线反向投影回参考平面 z=refZ, 求"表观物点"的横向 (x,y) 位置。
// 这是游客透过缸壁感知到的物体位置; 与真实参考点之差即畸变像移(毫米级)。
fn projectToReference(exitP: vec3<f32>, exitDir: vec3<f32>, refZ: f32) -> vec2<f32> {
  let tt = (refZ - exitP.z) / exitDir.z;
  let p = exitP + exitDir * tt;
  return p.xy;
}

@compute @workgroup_size(8, 8)
fn csMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let N = u32(U.gridN);
  if (gid.x >= N || gid.y >= N) { return; }
  let idx = gid.y * N + gid.x;

  // 参考平面坐标(米), 居中分布在 span×span; 竖直方向以相机高度为中心,
  // 使网格正中节点与相机等高(竖直倾角为 0), 避免把正常视角差误判为畸变
  let u = (f32(gid.x) / max(1.0, f32(N) - 1.0)) - 0.5;
  let v = (f32(gid.y) / max(1.0, f32(N) - 1.0)) - 0.5;
  let px = u * U.planeSpan;
  let py = v * U.planeSpan;
  // 参考平面放在缸后 refDistance(平面 z=-(t+refDistance))
  let pz = -(U.thickness + U.refDistance);
  let wp = vec3<f32>(px, py + U.camPos.y, pz);

  let step = U.planeSpan / max(1.0, f32(N) - 1.0);
  let refZ = -(U.thickness + U.refDistance);

  // 表观物点: 出壁折射光反向投影到参考平面的位置; z=1 有效
  var appPos = apparentObject(wp, refZ);
  // 无墙基线: 真实参考点位置本身(无墙时表观物点即真实点)
  var valid = appPos.z > 0.5;

  // 偏移量(毫米): 参考平面上表观物点与真实点的直线距离, 关于光轴对称、中心为 0
  var offsetMm = select(0.0, length(appPos.xy - wp.xy) * 1000.0, valid);

  // 放大率: 相邻参考点的表观物点间距 / 真实间距(中心差分)
  let appP = apparentObject(wp + vec3<f32>(step, 0.0, 0.0), refZ);
  let appM = apparentObject(wp - vec3<f32>(step, 0.0, 0.0), refZ);
  let appDx = length(appP.xy - appM.xy);
  let realDx = 2.0 * step;
  let mag = select(1.0, appDx / realDx, appP.z > 0.5 && appM.z > 0.5);

  outCells[idx] = DCell(offsetMm, mag, px, py);
}

// 经完整折射追迹后, 出射光反向投影到参考平面的表观物点; z=1 有效, z=0 失败(全反射)
fn apparentObject(wp: vec3<f32>, refZ: f32) -> vec3<f32> {
  let dir = normalize(U.camPos - wp);
  var exitP = vec3<f32>(0.0);
  let r = reverseTrace(wp, dir, &exitP);
  if (r.w < 0.5 || abs(r.z) < 1e-6) {
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let obj = projectToReference(exitP, r.xyz, refZ);
  return vec3<f32>(obj, 1.0);
}
