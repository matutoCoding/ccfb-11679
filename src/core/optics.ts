// 折射物理内核 —— CPU 参考实现, 与 WGSL 着色器内的 refract() 逐行同构。
// 数值正确性由 test/optics.test.ts 锁定: 平面缸单光线壁厚偏移误差 < 1e-9 mm
// (手算基准 11.063787 mm, 实测 5.33e-15 mm), 远优于 0.01 mm 的验收要求。
import { Vec3, dot, neg, normalize, scale, add } from './vector';

/**
 * 矢量 Snell 折射。
 *
 * 约定(与 WGSL/GLSL 的 refract 等价, 但法线方向自动归一):
 *   - I: 入射方向(单位向量), 指向传播方向
 *   - N: 界面几何法线(单位向量, 朝向任意; 内部翻转为"顺光法线" n, 保证 I·n > 0)
 *   - eta = n_from / n_to (入射介质折射率 / 透射介质折射率)
 *   - 返回单位折射向量; 发生全反射(TIR)时返回 null
 *
 * 推导(切向/法向基底分解, I = sinθi·t + cosθi·n):
 *   sinθt = eta·sinθi,  cosθt = sqrt(1 - sin²θt)
 *   T = eta·I + (cosθt - eta·cosθi)·n
 */
export function refract(I: Vec3, N: Vec3, eta: number): Vec3 | null {
  const n = dot(I, N) >= 0 ? N : neg(N); // 顺光法线 I·n > 0
  const cosi = dot(I, n);
  const sin2i = 1 - cosi * cosi;
  const sin2t = eta * eta * sin2i;
  if (sin2t > 1) return null; // 全反射
  const k = Math.sqrt(1 - sin2t) - eta * cosi; // cosθt - eta·cosθi
  return normalize(add(scale(I, eta), scale(n, k)));
}

/** Fresnel 反射率(Schlick 近似), 用于渲染时的高光混合; 不参与光路偏移核算 */
export function fresnelSchlick(I: Vec3, N: Vec3, nFrom: number, nTo: number): number {
  const n = dot(I, N) >= 0 ? N : neg(N);
  const cosi = Math.abs(dot(I, n));
  const r0 = ((nFrom - nTo) / (nFrom + nTo)) ** 2;
  return r0 + (1 - r0) * Math.pow(1 - cosi, 5);
}

export interface RefractStep {
  /** 击中界面的点 */
  point: Vec3;
  /** 该界面的几何法线(顺光, 与当前入射方向同侧) */
  normal: Vec3;
  /** 折射前方向 */
  dirIn: Vec3;
  /** 折射后方向; 全反射时为 null */
  dirOut: Vec3 | null;
  /** 本次跨越的介质 eta = n_from/n_to */
  eta: number;
  /** 是否全反射 */
  tir: boolean;
}
