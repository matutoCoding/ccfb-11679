// 可复用的 WebGPU 预览视口: 承载 RefractionRenderer, 提供拖拽轨道控制、
// FPS 监测、截图与 CPU 光路核对(中心光线壁厚偏移 vs 解析手算)。
import { el } from '../dom';
import { RefractionRenderer, FpsStats } from '../../gpu/RefractionRenderer';
import { ProjectData } from '../../core/types';
import { traceWall, planarWallOffsetAnalytic } from '../../core/tracer';
import { waterIorAt } from '../../core/waterIor';
import { v3, normalize } from '../../core/vector';

export interface ViewportHandle {
  root: HTMLElement;
  update: (p: ProjectData) => void;
  screenshot: () => Promise<string>;
  dispose: () => void;
}

export function createViewport(project: ProjectData, opts: { showRayCheck?: boolean; compact?: boolean } = {}): ViewportHandle {
  const canvas = el('canvas', {}) as HTMLCanvasElement;
  const fpsBadge = el('div', { class: 'badge', text: 'FPS: —' });
  const modeBadge = el('div', { class: 'badge', text: project.geometry.kind });
  const hud = el('div', { class: 'hud' }, [fpsBadge, modeBadge]);
  const rayPanel = opts.showRayCheck ? el('div', { class: 'ray-report', style: { position: 'absolute', right: '12px', bottom: '12px', width: '280px', pointerEvents: 'none' } }) : null;
  const root = el('div', { class: 'viewport' }, [canvas, hud, rayPanel].filter(Boolean) as HTMLElement[]);

  let renderer: RefractionRenderer | null = null;
  let current = structuredClone(project);
  let initError: string | null = null;

  function showUnsupported(msg: string): void {
    root.replaceChildren(el('div', { class: 'unsupported' }, [
      el('div', {}, [
        el('div', { class: 'big', text: '⚠️' }),
        el('p', { text: msg }),
      ]),
    ]));
  }

  const onStats = (s: FpsStats): void => {
    fpsBadge.textContent = `FPS: ${s.fps.toFixed(1)} · ${s.frameMs.toFixed(1)}ms`;
    fpsBadge.className = `badge ${s.fps >= 30 ? 'good' : s.fps >= 20 ? 'warn' : 'bad'}`;
  };

  try {
    renderer = new RefractionRenderer(canvas, current, onStats);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
  }

  // 异步初始化
  if (renderer) {
    renderer.init().then(() => {
      renderer!.start();
      bindControls();
      runRayCheck();
    }).catch((err) => {
      initError = err instanceof Error ? err.message : String(err);
      showUnsupported(initError);
    });
  } else if (initError) {
    showUnsupported(initError);
  }

  // 轨道控制: 左键拖拽旋转(球面轨道), 滚轮缩放
  let dragging = false;
  let lastX = 0, lastY = 0;
  const spherical = { yaw: 0, pitch: 0, radius: 5 };

  function syncSpherical(): void {
    const vp = current.viewpoint;
    const dx = vp.position[0] - vp.target[0];
    const dy = vp.position[1] - vp.target[1];
    const dz = vp.position[2] - vp.target[2];
    spherical.radius = Math.hypot(dx, dy, dz);
    spherical.yaw = Math.atan2(dx, dz);
    spherical.pitch = Math.asin(Math.max(-0.99, Math.min(0.99, dy / spherical.radius)));
  }
  syncSpherical();

  function applySpherical(): void {
    const t = current.viewpoint.target;
    const { yaw, pitch, radius } = spherical;
    const cp = Math.cos(pitch);
    const nx = t[0] + radius * cp * Math.sin(yaw);
    const ny = t[1] + radius * Math.sin(pitch);
    const nz = t[2] + radius * cp * Math.cos(yaw);
    current = structuredClone(current);
    current.viewpoint.position = [nx, ny, nz];
    renderer?.updateProject(current);
    runRayCheck();
  }

  function bindControls(): void {
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      spherical.yaw -= dx * 0.005;
      spherical.pitch = Math.max(-1.3, Math.min(1.3, spherical.pitch + dy * 0.005));
      applySpherical();
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      spherical.radius = Math.max(0.5, Math.min(20, spherical.radius * (1 + e.deltaY * 0.001)));
      applySpherical();
    }, { passive: false });
  }

  // CPU 光路核对: 屏幕中心光线(相机→target)的壁厚偏移, 与平面解析公式对比
  function runRayCheck(): void {
    if (!rayPanel) return;
    const vp = current.viewpoint;
    const origin = v3(vp.position[0], vp.position[1], vp.position[2]);
    const dir = normalize(v3(vp.target[0] - origin.x, vp.target[1] - origin.y, vp.target[2] - origin.z));
    const insideOut = current.geometry.kind === 'tunnel';
    const result = traceWall(current.geometry, current.optics, origin, dir, { direction: insideOut ? 'insideOut' : 'outsideIn' });

    const nWater = current.optics.waterIorOverride ?? waterIorAt(current.optics.waterTemperature);
    const rows: HTMLElement[] = [
      el('div', { class: 'row' }, [el('span', { class: 'k', text: '水 n' }), el('span', { class: 'mono', text: nWater.toFixed(5) })]),
    ];

    if (!result.ok) {
      rows.push(el('div', { class: 'row' }, [el('span', { class: 'k', text: '光路状态' }), el('span', { class: 'fail', text: result.reason ?? '失败' })]));
    } else {
      const offsetMm = result.firstWallOffset * 1000;
      rows.push(el('div', { class: 'row' }, [el('span', { class: 'k', text: '壁厚偏移' }), el('span', { class: 'mono', text: `${offsetMm.toFixed(4)} mm` })]));
      // 平面缸额外给出解析手算值与误差
      if (current.geometry.kind === 'planar') {
        // 入射角 = 光线与面板法线(-z)的夹角
        const cosI = Math.abs(dir.z);
        const incDeg = Math.acos(Math.min(1, cosI)) * 180 / Math.PI;
        const analytic = planarWallOffsetAnalytic(current.geometry.wallThickness, incDeg, current.optics.airIor, current.optics.acrylicIor);
        const errMm = Math.abs(result.firstWallOffset - analytic) * 1000;
        rows.push(el('div', { class: 'row' }, [el('span', { class: 'k', text: '入射角' }), el('span', { class: 'mono', text: `${incDeg.toFixed(2)}°` })]));
        rows.push(el('div', { class: 'row' }, [el('span', { class: 'k', text: '手算基准' }), el('span', { class: 'mono', text: `${(analytic * 1000).toFixed(4)} mm` })]));
        rows.push(el('div', { class: 'row' }, [
          el('span', { class: 'k', text: '核对误差' }),
          el('span', { class: errMm < 0.01 ? 'pass mono' : 'fail mono', text: `${errMm.toExponential(2)} mm` }),
        ]));
      }
    }
    rayPanel.replaceChildren(...rows);
  }

  return {
    root,
    update(p: ProjectData): void {
      current = structuredClone(p);
      // 保持当前轨道姿态, 仅在目标变化时同步
      syncSpherical();
      renderer?.updateProject(current);
      modeBadge.textContent = current.geometry.kind;
      runRayCheck();
    },
    async screenshot(): Promise<string> {
      if (renderer) return renderer.capturePng();
      return '';
    },
    dispose(): void {
      renderer?.destroy();
    },
  };
}
