// 折射率物理常量与水的折射率-温度关系。
// 水的数据: Daimon & Masumura (2007), 钠光 589nm, 0~100°C 实测值。
// 用最小二乘三次多项式拟合, 最大残差 6.2e-5 (对应角度误差 < 0.005°, 工程可忽略)。
// 同一组系数同时写入 WGSL 着色器, 保证 CPU 核算与 GPU 渲染光路完全一致。

export const PHYSICS = {
  /** 空气折射率(标准状况, 589nm) */
  airIor: 1.000293,
  /** 亚克力(PMMA)典型折射率, 可在设置中覆盖 */
  acrylicIor: 1.491,
  /** 真空光速 m/s */
  speedOfLight: 299792458,
  /** 钠光参考波长 nm */
  referenceWavelengthNm: 589,
} as const;

// n_water(T) = c0 + c1*T + c2*T^2 + c3*T^3, T 单位摄氏度
export const WATER_IOR_COEFFS = {
  c0: 1.3335153,
  c1: 3.29440948e-5,
  c2: -2.17948135e-6,
  c3: 6.6540404e-9,
} as const;

/** 拟合所用的实测锚点, 也用于设置页展示与核对 */
export const WATER_IOR_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 1.333465],
  [10, 1.333695],
  [20, 1.333394],
  [30, 1.332718],
  [40, 1.331737],
  [50, 1.330506],
  [60, 1.329064],
  [70, 1.327439],
  [80, 1.325648],
  [90, 1.323706],
  [100, 1.321634],
];

/** 合理水温范围(°C), 超出后钳制并给出提示 */
export const WATER_TEMP_RANGE = { min: 0, max: 60 } as const;

/**
 * 由水温计算水的折射率(589nm)。
 * 与 WGSL 中的 waterIor() 使用完全相同的系数与运算顺序。
 */
export function waterIorAt(temperatureC: number): number {
  const T = Math.min(WATER_TEMP_RANGE.max, Math.max(WATER_TEMP_RANGE.min, temperatureC));
  const { c0, c1, c2, c3 } = WATER_IOR_COEFFS;
  return c0 + c1 * T + c2 * T * T + c3 * T * T * T;
}
