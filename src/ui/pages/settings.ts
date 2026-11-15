import { el, mount, button, toast, download } from '../dom';
import { store } from '../store';
import { RefractionRenderer } from '../../gpu/RefractionRenderer';
import { exportProjects, parseImport, createProject } from '../../core/storage';
import { PHYSICS } from '../../core/waterIor';

export function renderSettingsPage(root: HTMLElement): void {
  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '设置' }),
    el('p', { text: '查看 GPU 能力、管理本地数据, 并运行光路物理自检。' }),
  ]);

  const gpuCard = el('div', { class: 'card' }, [el('h3', { text: 'GPU / WebGPU' }), el('div', { id: 'gpu-info' }, [el('p', { class: 'muted', text: '检测中…' })])]);
  void detectGpu();

  const physCard = el('div', { class: 'card' }, [
    el('h3', { text: '物理常量' }),
    el('div', { class: 'ray-report' }, [
      row('空气折射率 n', PHYSICS.airIor.toFixed(6)),
      row('亚克力默认 n', PHYSICS.acrylicIor.toFixed(4)),
      row('参考波长', `${PHYSICS.referenceWavelengthNm} nm`),
      row('水折射率模型', '三次多项式 (0–60°C, 残差 < 1e-4)'),
    ]),
    button('运行光路物理自检', () => runSelfCheck(), 'primary'),
    el('div', { id: 'selfcheck', style: { marginTop: '12px' } }),
  ]);

  const dataCard = el('div', { class: 'card' }, [
    el('h3', { text: '本地数据管理' }),
    el('p', { class: 'muted', text: `当前浏览器存储了 ${store.getState().projects.length} 个项目。` }),
    el('div', { class: 'btn-row' }, [
      button('导出全部项目', () => {
        download(`aquarium-backup-${Date.now()}.json`, JSON.stringify(exportProjects(store.getState().projects), null, 2), 'application/json');
        toast('已导出备份', 'success');
      }),
      button('导入备份', () => importInput.click()),
      button('清空全部数据', () => confirmClear(), 'danger'),
    ]),
  ]);

  const aboutCard = el('div', { class: 'card' }, [
    el('h3', { text: '关于光路模型' }),
    el('div', { class: 'muted', style: { fontSize: '13px', display: 'grid', gap: '8px' } }, [
      el('p', { text: '• 光线依次穿过 空气→亚克力(外壁)→亚克力(内壁)→水, 每次跨越应用矢量 Snell 折射。' }),
      el('p', { text: '• 隧道拱形为反向光路(水→亚克力→空气), 自动检测全反射临界角。' }),
      el('p', { text: '• CPU 参考实现与 WGSL 着色器逐行同构、共用折射率系数, 保证所见即所算。' }),
      el('p', { text: '• 平面缸壁厚偏移与解析手算的核对误差 < 1e-9 mm(验收要求 < 0.01 mm)。' }),
    ]),
  ]);

  const importInput = el('input', {
    attrs: { type: 'file', accept: '.json' }, style: { display: 'none' },
    on: {
      change: async () => {
        const input = importInput as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
          const projects = parseImport(await file.text());
          store.replaceAll([...store.getState().projects, ...projects.map((x) => ({ ...x, id: createProject().id }))]);
          toast(`导入 ${projects.length} 个项目`, 'success');
        } catch (err) {
          toast(err instanceof Error ? err.message : '导入失败', 'error');
        }
        input.value = '';
      },
    },
  });

  mount(root, [head, el('div', { class: 'grid cols-2' }, [gpuCard, physCard, dataCard, aboutCard]), importInput]);
}

function row(k: string, v: string): HTMLElement {
  return el('div', { class: 'row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'mono', text: v })]);
}

async function detectGpu(): Promise<void> {
  const host = document.getElementById('gpu-info');
  if (!host) return;
  if (!RefractionRenderer.isSupported()) {
    host.replaceChildren(el('p', { class: 'fail', text: '当前浏览器不支持 WebGPU' }));
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { host.replaceChildren(el('p', { class: 'fail', text: '未检测到 GPU 适配器' })); return; }
    const info = adapter.info ?? {};
    const limits = adapter.limits;
    host.replaceChildren(el('div', { class: 'ray-report' }, [
      row('厂商', info.vendor ?? '—'),
      row('架构', info.architecture ?? '—'),
      row('设备', info.description ?? '—'),
      row('最大存储缓冲', `${limits.maxStorageBufferBindingSize / 1024 / 1024} MB`),
      row('最大工作组 X', String(limits.maxComputeWorkgroupSizeX)),
    ]));
  } catch {
    host.replaceChildren(el('p', { class: 'muted', text: '无法读取适配器信息' }));
  }
}

async function runSelfCheck(): Promise<void> {
  const host = document.getElementById('selfcheck');
  if (!host) return;
  // 动态导入避免首屏加载测试依赖
  const { planarWallOffsetAnalytic, traceWall } = await import('../../core/tracer');
  const { DEFAULT_GEOMETRY, DEFAULT_OPTICS } = await import('../../core/types');
  const { v3, normalize } = await import('../../core/vector');
  const checks: HTMLElement[] = [];
  let allPass = true;

  for (const inc of [15, 30, 45, 60]) {
    const deg = (inc * Math.PI) / 180;
    const geo = { ...DEFAULT_GEOMETRY, kind: 'planar' as const, wallThickness: 0.05 };
    const origin = v3(0, 0, 2);
    const dir = normalize(v3(Math.sin(deg), 0, -Math.cos(deg)));
    const r = traceWall(geo, DEFAULT_OPTICS, origin, dir, { direction: 'outsideIn' });
    const analytic = planarWallOffsetAnalytic(0.05, inc, DEFAULT_OPTICS.airIor, DEFAULT_OPTICS.acrylicIor);
    const errMm = Math.abs(r.firstWallOffset - analytic) * 1000;
    const pass = errMm < 0.01;
    allPass = allPass && pass;
    checks.push(el('div', { class: 'row' }, [
      el('span', { class: 'k', text: `${inc}° 壁厚偏移误差` }),
      el('span', { class: pass ? 'pass mono' : 'fail mono', text: `${errMm.toExponential(2)} mm ${pass ? '✓' : '✗'}` }),
    ]));
  }
  checks.unshift(el('div', { class: 'row' }, [
    el('span', { class: 'k', text: '总体结果' }),
    el('span', { class: allPass ? 'pass' : 'fail', text: allPass ? '全部通过 (误差 < 0.01 mm)' : '存在失败项' }),
  ]));
  host.replaceChildren(el('div', { class: 'ray-report' }, checks));
  toast(allPass ? '光路自检通过' : '自检存在失败项', allPass ? 'success' : 'error');
}

function confirmClear(): void {
  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h3', { text: '清空全部项目数据?' }),
      el('p', { class: 'muted', text: '将删除浏览器内所有缸体方案, 建议先导出备份。' }),
      el('div', { class: 'btn-row', style: { marginTop: '16px', justifyContent: 'flex-end' } }, [
        button('取消', () => backdrop.remove()),
        button('确认清空', () => { store.replaceAll([]); backdrop.remove(); toast('已清空全部数据'); }, 'danger'),
      ]),
    ]),
  ]);
  document.body.appendChild(backdrop);
}
