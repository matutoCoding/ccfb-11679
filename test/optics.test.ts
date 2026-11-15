import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { v3, normalize, dot, neg } from '../src/core/vector';
import { refract } from '../src/core/optics';
import { waterIorAt, WATER_IOR_TABLE, WATER_IOR_COEFFS } from '../src/core/waterIor';
import {
  planarWallOffsetAnalytic,
  traceWall,
  totalOffsetAtReference,
} from '../src/core/tracer';
import {
  DEFAULT_GEOMETRY,
  DEFAULT_OPTICS,
  TankGeometry,
  OpticsConfig,
} from '../src/core/types';

const MM = 1000;

describe('矢量 Snell 折射内核', () => {
  const na = 1.000293, ng = 1.491, nw = 1.333;

  test('平面 30° 空气→亚克力折射角等于解析值 19.5995°', () => {
    const deg = (30 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    const N = v3(0, 0, 1); // 顺光法线
    const T = refract(I, N, na / ng)!;
    const angle = Math.atan2(T.x, T.z) * 180 / Math.PI;
    assert.ok(Math.abs(angle - 19.599519) < 1e-4, `角度=${angle}`);
  });

  test('法线朝向无关: 传入反向法线结果一致', () => {
    const deg = (30 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    const t1 = refract(I, v3(0, 0, 1), na / ng)!;
    const t2 = refract(I, v3(0, 0, -1), na / ng)!;
    assert.ok(Math.abs(t1.x - t2.x) < 1e-12);
    assert.ok(Math.abs(t1.z - t2.z) < 1e-12);
  });

  test('斜法线满足 Snell 切向守恒 sinθt/sinθi = n_from/n_to', () => {
    const deg = (35 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    const N = normalize(v3(0.25, 0, 1));
    const T = refract(I, N, na / ng)!;
    const ci = Math.abs(dot(I, N)), ct = Math.abs(dot(T, N));
    const sini = Math.sqrt(1 - ci * ci), sint = Math.sqrt(1 - ct * ct);
    assert.ok(Math.abs(sint / sini - na / ng) < 1e-9);
  });

  test('水→空气 60° 超过临界角触发全反射返回 null', () => {
    const deg = (60 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    assert.equal(refract(I, v3(0, 0, 1), nw / na), null);
  });

  test('水→空气 30° 低于临界角正常折射', () => {
    const deg = (30 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    assert.ok(refract(I, v3(0, 0, 1), nw / na) !== null);
  });

  test('光路可逆: 空气→亚克力→水 反向追迹恢复原方向', () => {
    const deg = (30 * Math.PI) / 180;
    const I = normalize(v3(Math.sin(deg), 0, Math.cos(deg)));
    const N = v3(0, 0, 1);
    const d1 = refract(I, N, na / ng)!;
    const d2 = refract(d1, N, ng / nw)!;
    // 反向光沿 -z 传播, 其顺光法线为 -z(refract 自动翻转, 这里显式给 -z)
    const Nback = v3(0, 0, -1);
    const r1 = refract(neg(d2), Nback, nw / ng)!;
    const r2 = refract(r1, Nback, ng / na)!;
    // 反向追迹沿原光路返回, 终点方向为 -I(与原入射相反)
    assert.ok(Math.hypot(r2.x + I.x, r2.z + I.z) < 1e-12);
  });
});

describe('平面缸壁厚偏移 —— 0.01mm 验收', () => {
  const optics: OpticsConfig = { ...DEFAULT_OPTICS };
  const geo: TankGeometry = {
    ...DEFAULT_GEOMETRY,
    kind: 'planar',
    wallThickness: 0.05,
  };

  test('手算基准: t=50mm, 30° 入射, 壁厚偏移 = 11.063787 mm', () => {
    const analytic = planarWallOffsetAnalytic(0.05, 30, 1.000293, 1.491);
    assert.ok(Math.abs(analytic * MM - 11.063787) < 1e-5, `解析=${analytic * MM}`);
  });

  test('追踪器输出与手算基准误差 < 0.01 mm', () => {
    const deg = (30 * Math.PI) / 180;
    // 起点在缸外 +z, 光朝 -z 方向打到 z=0 外壁
    const origin = v3(0, 0, 2);
    const dir = normalize(v3(Math.sin(deg), 0, -Math.cos(deg)));
    const result = traceWall(geo, optics, origin, dir, { direction: 'outsideIn' });
    assert.ok(result.ok, result.reason);
    const errMm = Math.abs(result.firstWallOffset * MM - 11.063787);
    assert.ok(errMm < 0.01, `误差=${errMm} mm, 实际=${result.firstWallOffset * MM}`);
  });

  test('多个入射角全部与解析公式吻合(误差 < 1e-6 mm)', () => {
    for (const inc of [5, 15, 30, 45, 60, 75]) {
      const deg = (inc * Math.PI) / 180;
      const origin = v3(0, 0, 2);
      const dir = normalize(v3(Math.sin(deg), 0, -Math.cos(deg)));
      const result = traceWall(geo, optics, origin, dir, { direction: 'outsideIn' });
      const analytic = planarWallOffsetAnalytic(0.05, inc, optics.airIor, optics.acrylicIor);
      assert.ok(result.ok, `${inc}°: ${result.reason}`);
      const errMm = Math.abs(result.firstWallOffset * MM - analytic * MM);
      assert.ok(errMm < 1e-6, `${inc}° 误差=${errMm} mm`);
    }
  });

  test('正入射(0°)壁厚偏移为 0', () => {
    const origin = v3(0, 0, 2);
    const result = traceWall(geo, optics, origin, v3(0, 0, -1), { direction: 'outsideIn' });
    assert.ok(result.ok);
    assert.ok(result.firstWallOffset * MM < 1e-9);
  });

  test('参考平面总错位可计算且为有限值', () => {
    const deg = (30 * Math.PI) / 180;
    const origin = v3(0, 0, 2);
    const dir = normalize(v3(Math.sin(deg), 0, -Math.cos(deg)));
    const result = traceWall(geo, optics, origin, dir, { direction: 'outsideIn' });
    const total = totalOffsetAtReference(result, 0.5);
    assert.ok(Number.isFinite(total) && total > 0);
  });
});

describe('圆柱与隧道缸光路', () => {
  test('圆柱缸正入射(沿径向)不偏折, 偏移≈0', () => {
    const geo: TankGeometry = { ...DEFAULT_GEOMETRY, kind: 'cylinder', radius: 3, wallThickness: 0.05 };
    // 从缸外沿 -z 径向打入, 击中 (0,0,R) 处, 法线与光线平行
    const origin = v3(0, 0, 6);
    const result = traceWall(geo, DEFAULT_OPTICS, origin, v3(0, 0, -1), { direction: 'outsideIn' });
    assert.ok(result.ok, result.reason);
    assert.ok(result.wallOffset < 1e-9, `偏移=${result.wallOffset}`);
  });

  test('圆柱缸斜入射产生非零偏移且光路完整', () => {
    const geo: TankGeometry = { ...DEFAULT_GEOMETRY, kind: 'cylinder', radius: 3, wallThickness: 0.05 };
    const origin = v3(1.5, 0, 6);
    const dir = normalize(v3(-0.2, 0, -1));
    const result = traceWall(geo, DEFAULT_OPTICS, origin, dir, { direction: 'outsideIn' });
    assert.ok(result.ok, result.reason);
    assert.ok(result.wallOffset > 0);
    assert.equal(result.steps.length, 2);
  });

  test('隧道 insideOut 追迹两层壁不报错且出射方向合理', () => {
    const geo: TankGeometry = { ...DEFAULT_GEOMETRY, kind: 'tunnel', radius: 3, wallThickness: 0.05 };
    const origin = v3(0, 1.5, 0); // 游客在内部
    const dir = normalize(v3(0, 0.3, 1));
    const result = traceWall(geo, DEFAULT_OPTICS, origin, dir, { direction: 'insideOut' });
    assert.ok(result.ok, result.reason);
    assert.equal(result.steps.length, 2);
    assert.ok(result.dirOut !== null);
  });
});

describe('水折射率-温度关系', () => {
  test('20°C 折射率接近实测 1.333394', () => {
    const n = waterIorAt(20);
    assert.ok(Math.abs(n - 1.333394) < 2e-4, `n=${n}`);
  });

  test('三次拟合在全表最大残差 < 1e-4', () => {
    const { c0, c1, c2, c3 } = WATER_IOR_COEFFS;
    let maxErr = 0;
    for (const [T, expected] of WATER_IOR_TABLE) {
      const n = c0 + c1 * T + c2 * T * T + c3 * T * T * T;
      maxErr = Math.max(maxErr, Math.abs(n - expected));
    }
    assert.ok(maxErr < 1e-4, `maxErr=${maxErr}`);
  });

  test('温度越界被钳制到 [0,60]', () => {
    assert.ok(Number.isFinite(waterIorAt(-50)));
    assert.ok(Number.isFinite(waterIorAt(200)));
    assert.equal(waterIorAt(-50), waterIorAt(0));
  });

  test('升温折射率下降(20°C → 40°C)', () => {
    assert.ok(waterIorAt(40) < waterIorAt(20));
  });
});
