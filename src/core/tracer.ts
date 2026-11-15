// 光路追踪器: 单条光线穿过空气→亚克力(外壁)→亚克力(内壁)→水(或反向),
// 每次跨越应用一次矢量 Snell 折射。输出壁厚横向偏移量等可与手算核对的量。
import { Vec3, dot, normalize, rayAt, sub, scale, add } from './vector';
import { refract, RefractStep } from './optics';
import { buildWallSurfaces, RayHit, Surface } from './geometry';
import { TankGeometry, OpticsConfig } from './types';
import { waterIorAt } from './waterIor';

export interface TraceResult {
  /** 是否完整穿过两层壁(未发生全反射、未漏交) */
  ok: boolean;
  /** 失败原因(全反射/未击中) */
  reason?: string;
  /** 起点(空气或水中, 取决于观察方向) */
  origin: Vec3;
  /** 初始方向 */
  dirIn: Vec3;
  /** 出壁后的最终方向(进入另一侧介质) */
  dirOut: Vec3 | null;
  /** 两次折射的逐步记录(外壁、内壁) */
  steps: RefractStep[];
  /**
   * 壁厚横向偏移量(米): 出末界面点相对"无墙直线"在同一光程距离处的总错位(两段累积)。
   */
  wallOffset: number;
  /**
   * 第一段(亚克力壁厚内)单段横向偏移(米)。
   * 平面缸即手算公式 t(tanθi - tanθg), 是 0.01mm 验收的直接核对量。
   */
  firstWallOffset: number;
  /** 各介质折射率, 便于报告输出 */
  iors: { air: number; acrylic: number; water: number };
}

export interface TraceOptions {
  /** 观察方向: outsideIn = 游客在空气看向水中(平面/圆柱); insideOut = 游客在水中(隧道) */
  direction: 'outsideIn' | 'insideOut';
}

function effectiveWaterIor(opt: OpticsConfig): number {
  return opt.waterIorOverride ?? waterIorAt(opt.waterTemperature);
}

/**
 * 追踪一条光线穿过缸壁。
 * @param geometry 缸体几何
 * @param optics 折射率配置
 * @param origin 光线起点
 * @param dir 单位方向
 */
export function traceWall(
  geometry: TankGeometry,
  optics: OpticsConfig,
  origin: Vec3,
  dir: Vec3,
  options: TraceOptions,
): TraceResult {
  const iorAir = optics.airIor;
  const iorAcrylic = optics.acrylicIor;
  const iorWater = effectiveWaterIor(optics);
  const iors = { air: iorAir, acrylic: iorAcrylic, water: iorWater };

  const { surfaces } = buildWallSurfaces(geometry);
  const steps: RefractStep[] = [];
  let pos = origin;
  let d = normalize(dir);

  // 介质序列。outsideIn: 空气→亚克力→水; insideOut: 水→亚克力→空气
  const media =
    options.direction === 'outsideIn'
      ? [
          { from: iorAir, to: iorAcrylic },
          { from: iorAcrylic, to: iorWater },
        ]
      : [
          { from: iorWater, to: iorAcrylic },
          { from: iorAcrylic, to: iorAir },
        ];

  // 隧道(insideOut)界面顺序与表面数组相反; 平面/圆柱按数组顺序
  const orderedSurfaces: Surface[] =
    options.direction === 'insideOut' ? [...surfaces].reverse() : surfaces;

  let wallOffset = 0;
  let firstWallOffset = 0;
  const entryOrigin = pos;
  const entryDir = d;
  // 沿实际折线路径累计的几何距离(用于末点的无偏折投影)
  let pathDistance = 0;

  for (let i = 0; i < orderedSurfaces.length; i++) {
    const hit: RayHit | null = orderedSurfaces[i].intersect(pos, d);
    if (!hit) {
      return { ok: false, reason: `未击中第 ${i + 1} 层壁面`, origin, dirIn: dir, dirOut: null, steps, wallOffset, firstWallOffset, iors };
    }
    const segLen = hit.t;
    pathDistance += segLen;
    const eta = media[i].from / media[i].to;
    const dirIn = d;
    const out = refract(d, hit.normal, eta);
    if (out === null) {
      steps.push({ point: hit.point, normal: hit.normal, dirIn, dirOut: null, eta, tir: true });
      return { ok: false, reason: `第 ${i + 1} 层界面发生全反射`, origin, dirIn: dir, dirOut: null, steps, wallOffset, firstWallOffset, iors };
    }
    // 顺光法线(与当前入射同侧), 记录用
    const nAlong = dot(d, hit.normal) >= 0 ? hit.normal : scale(hit.normal, -1);
    steps.push({ point: hit.point, normal: nAlong, dirIn, dirOut: out, eta, tir: false });

    // 起点就放在界面上; 下一表面求交器自带 1e-9 正向过滤, 不会自交
    pos = hit.point;
    d = out;

    // 末界面(内壁)处测量壁厚横向偏移:
    // 在内壁界面平面上, 实际击中处与"无偏折入射直线在该平面的交点"之差。
    // 平面缸即手算 t(tanθi-tanθg); 曲面缸该量同样定义清晰、可与 CAD 比对。
    if (i === orderedSurfaces.length - 1) {
      // 取与入射方向顺光的法线, 保证平面投影参数为正
      const sn = dot(entryDir, hit.normal) >= 0 ? hit.normal : scale(hit.normal, -1);
      const denom = dot(entryDir, sn);
      if (Math.abs(denom) > 1e-12) {
        const tPlane = (dot(hit.point, sn) - dot(entryOrigin, sn)) / denom;
        const straight = rayAt(entryOrigin, entryDir, tPlane);
        firstWallOffset = Math.sqrt(dot(sub(hit.point, straight), sub(hit.point, straight)));
      }
      // 总横向偏移: 实际出射点 与 无墙直线在同一光程距离处的点 之差
      const undeviated = rayAt(entryOrigin, entryDir, pathDistance);
      wallOffset = Math.sqrt(
        dot(sub(hit.point, undeviated), sub(hit.point, undeviated)),
      );
    }
  }

  return { ok: true, origin, dirIn: dir, dirOut: d, steps, wallOffset, firstWallOffset, iors };
}

/**
 * 平面缸壁厚偏移的解析公式(手算基准), 单位米:
 *   offset = t (tanθi - tanθg),  sinθg = (n_air/n_acrylic) sinθi
 * 仅适用于平面、空气→亚克力→水的第一段(壁厚内)。
 */
export function planarWallOffsetAnalytic(
  wallThickness: number,
  incidenceDeg: number,
  iorAir: number,
  iorAcrylic: number,
): number {
  const thetaI = (incidenceDeg * Math.PI) / 180;
  const sinG = (iorAir / iorAcrylic) * Math.sin(thetaI);
  const thetaG = Math.asin(sinG);
  return wallThickness * (Math.tan(thetaI) - Math.tan(thetaG));
}

/** 出壁后继续在水中传播到参考平面的总横向错位(相对无墙直线), 单位米 */
export function totalOffsetAtReference(result: TraceResult, referenceDistance: number): number {
  if (!result.ok || !result.dirOut || result.steps.length < 2) return NaN;
  const last = result.steps[result.steps.length - 1];
  const refPoint = add(last.point, scale(result.dirOut, referenceDistance));
  const undeviated = rayAt(
    result.origin,
    result.dirIn,
    dot(sub(last.point, result.origin), result.dirIn) + referenceDistance,
  );
  return Math.sqrt(dot(sub(refPoint, undeviated), sub(refPoint, undeviated)));
}
