// 缸体几何与光线求交。CPU 参考实现, 与 WGSL 中的求交函数逐行同构。
// 坐标系(米): x 水平向右, y 竖直向上, z 水平光轴。
//   平面缸: 面板在 z=0, 亚克力占 z∈[-t,0], 水体在 z<-t 一侧; 游客在 +z 侧。
//   圆柱缸: 轴沿 y, 外壁半径 R, 内壁半径 R-t, 水体在内壁以内。
//   隧道拱: 轴沿 x 的半圆柱, 游客在内部水体, 经内壁→亚克力→外壁看向外部空气。
import { Vec3, add, dot, normalize, rayAt, scale, sub } from './vector';
import { TankGeometry } from './types';

export interface RayHit {
  /** 光线参数 t (>0), 击中位置 = origin + dir*t */
  t: number;
  point: Vec3;
  /** 几何外法线(单位, 朝向缸外/空气侧) */
  normal: Vec3;
}

export interface Surface {
  /** 求光线与该表面的最近正向交点; 无交点返回 null */
  intersect(origin: Vec3, dir: Vec3): RayHit | null;
}

/** 无限大平面: 点 p 满足 dot(p, normal) = d。求交与法线朝向、光线方向无关 */
export class PlaneSurface implements Surface {
  constructor(private normal: Vec3, private d: number) {}
  intersect(origin: Vec3, dir: Vec3): RayHit | null {
    const denom = dot(dir, this.normal);
    if (Math.abs(denom) < 1e-12) return null;
    // 无符号距离 / 带符号速率: 无论光线朝法线正向还是反向, 都能得到正的前进参数
    const t = (this.d - dot(origin, this.normal)) / denom;
    if (!Number.isFinite(t) || t <= 1e-9) return null;
    return { t, point: rayAt(origin, dir, t), normal: this.normal };
  }
}

/** 轴向沿 y 的无限圆柱: x² + z² = r², 外法线沿径向向外 */
export class CylinderSurface implements Surface {
  constructor(private radius: number) {}
  intersect(origin: Vec3, dir: Vec3): RayHit | null {
    // 消去 y, 在 xz 平面解二次方程
    const ox = origin.x, oz = origin.z;
    const dx = dir.x, dz = dir.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-15) return null;
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - this.radius * this.radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    const t = t1 > 1e-9 ? t1 : t2 > 1e-9 ? t2 : NaN;
    if (!Number.isFinite(t)) return null;
    const point = rayAt(origin, dir, t);
    const normal = normalize({ x: point.x, y: 0, z: point.z });
    return { t, point, normal };
  }
}

/** 隧道拱形: 轴向沿 x 的半圆柱, 仅保留 y >= floorY 的上半部分 */
export class TunnelArchSurface implements Surface {
  constructor(private radius: number, private floorY: number) {}
  intersect(origin: Vec3, dir: Vec3): RayHit | null {
    // 消去 x, 在 yz 平面求解
    const oy = origin.y, oz = origin.z;
    const dy = dir.y, dz = dir.z;
    const a = dy * dy + dz * dz;
    if (a < 1e-15) return null;
    const b = 2 * (oy * dy + oz * dz);
    const c = oy * oy + oz * oz - this.radius * this.radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
      if (t <= 1e-9) continue;
      const point = rayAt(origin, dir, t);
      if (point.y < this.floorY - 1e-9) continue; // 落到地面以下, 非拱面
      const normal = normalize({ x: 0, y: point.y, z: point.z });
      return { t, point, normal };
    }
    return null;
  }
}

/** 一组按光线传播顺序排列的缸壁界面(外壁→内壁, 或隧道的内壁→外壁) */
export interface WallSurfaces {
  /** 从给定起点沿光线会依次穿过的界面(最多两个: 外壁、内壁) */
  surfaces: Surface[];
}

/** 依据缸体类型构建两层亚克力壁表面。t = 壁厚, R = 外壁半径 */
export function buildWallSurfaces(geo: TankGeometry): WallSurfaces {
  const t = geo.wallThickness;
  switch (geo.kind) {
    case 'planar': {
      // 外壁 z=0(法线+z 朝游客/空气), 内壁 z=-t(同法线)
      return {
        surfaces: [
          new PlaneSurface({ x: 0, y: 0, z: 1 }, 0),
          new PlaneSurface({ x: 0, y: 0, z: 1 }, -t),
        ],
      };
    }
    case 'cylinder': {
      // 外壁 R, 内壁 R-t, 法线均径向向外
      return {
        surfaces: [new CylinderSurface(geo.radius), new CylinderSurface(geo.radius - t)],
      };
    }
    case 'tunnel': {
      // 统一按 outsideIn 顺序存储: 外壁 R 在前, 内壁 R-t 在后
      // (游客在内部时由追踪器反转; 表面法线朝向无关, 求交器双向可用)
      const floorY = 0;
      return {
        surfaces: [
          new TunnelArchSurface(geo.radius, floorY),
          new TunnelArchSurface(geo.radius - t, floorY),
        ],
      };
    }
  }
}

/** 计算点到直线(origin,dir)的垂直距离, 用于壁厚偏移量核算 */
export function perpendicularDistance(point: Vec3, origin: Vec3, dir: Vec3): number {
  const ap = sub(point, origin);
  const proj = scale(dir, dot(ap, dir));
  return Math.sqrt(dot(sub(ap, proj), sub(ap, proj)));
}

export { add };
