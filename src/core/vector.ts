// 三维向量数学 —— 纯函数, 同时供 CPU 光路核算与单元测试使用
export type Vec3 = { x: number; y: number; z: number };

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthSq = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-15 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add(scale(a, 1 - t), scale(b, t));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** 点沿光线行进: origin + dir * t */
export const rayAt = (origin: Vec3, dir: Vec3, t: number): Vec3 =>
  add(origin, scale(dir, t));
