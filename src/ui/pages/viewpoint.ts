import { el, mount, button, sliderField, toast } from '../dom';
import { store } from '../store';
import { registerDisposer } from '../../main';
import { createViewport, ViewportHandle } from '../components/viewport';
import { ProjectData } from '../../core/types';

export function renderViewpointPage(root: HTMLElement): void {
  const p = store.current!;
  const state = store.getState();
  const patch = store.patchCurrent.bind(store);

  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '视点预览' }),
    el('p', { text: '拖动画面旋转游客视点, 滚轮缩放; 变形实时计算。右下角为中心光线的 CPU 光路核对。' }),
  ]);

  const compareProject = state.compareId
    ? state.projects.find((x) => x.id === state.compareId) ?? null
    : null;

  const toolbar = el('div', { class: 'toolbar' }, [
    button('📷 截图 PNG', async () => {
      const url = await handle.screenshot();
      if (!url) { toast('截图失败: 渲染器未就绪', 'error'); return; }
      const a = el('a', { attrs: { href: url, download: `${p.name}-${Date.now()}.png` } }) as HTMLAnchorElement;
      a.click();
      toast('已保存截图', 'success');
    }, 'primary'),
    compareToggle(compareProject),
  ]);

  // 侧栏: 视点与渲染参数
  const side = el('div', { class: 'side-panel' }, [
    el('h3', { text: '游客视点' }),
    sliderField('视场角 FOV', p.viewpoint.fovY, '°', 20, 100, 1, (v) => patch((d) => { d.viewpoint.fovY = v; })),
    sliderField('注视点高度', p.viewpoint.target[1], 'm', 0, 5, 0.1, (v) => patch((d) => { d.viewpoint.target[1] = v; })),
    el('div', { class: 'section-title', text: '渲染设置' }),
    sliderField('分辨率比例', p.render.resolutionScale, 'x', 0.5, 1, 0.05, (v) => patch((d) => { d.render.resolutionScale = v; })),
    sliderField('曝光', p.render.exposure, '', 0.3, 2, 0.05, (v) => patch((d) => { d.render.exposure = v; })),
    checkboxRow('显示参考网格', p.render.showGrid, (v) => patch((d) => { d.render.showGrid = v; })),
    checkboxRow('鱼群动画', p.render.animateFish, (v) => patch((d) => { d.render.animateFish = v; })),
    checkboxRow('中心光线标记', p.render.debugRay, (v) => patch((d) => { d.render.debugRay = v; })),
    el('p', { class: 'muted', style: { fontSize: '12px', marginTop: '16px' }, text: '提示: 1080p 下若帧率不足, 可降低分辨率比例; 关闭鱼群动画可进一步减负。' }),
  ]);

  const viewportHost = el('div', { style: { flex: '1', display: 'flex', gap: '16px', minWidth: '0' } });
  const wrap = el('div', { class: 'viewport-wrap' }, [viewportHost, side]);

  let handle: ViewportHandle;
  let compareHandle: ViewportHandle | null = null;

  function buildViewports(): void {
    viewportHost.replaceChildren();
    handle?.dispose();
    compareHandle?.dispose();
    handle = createViewport(store.current!, { showRayCheck: !compareProject });
    const host1 = labeledWrap(handle.root, store.current!.name);
    viewportHost.appendChild(host1);
    if (compareProject) {
      compareHandle = createViewport(compareProject, { showRayCheck: true });
      viewportHost.appendChild(labeledWrap(compareHandle.root, `对比: ${compareProject.name}`));
    } else {
      compareHandle = null;
    }
  }

  // 项目参数变化时刷新主视口(对比视口保持其自身方案)
  const unsub = store.subscribe(() => {
    const cur = store.current;
    if (cur && state.page === 'viewpoint') handle?.update(cur);
  });

  buildViewports();

  mount(root, [head, toolbar, wrap]);

  // 页面切换时由主入口统一销毁 WebGPU 资源并取消订阅
  registerDisposer(() => { unsub(); handle?.dispose(); compareHandle?.dispose(); });
}

function labeledWrap(viewport: HTMLElement, label: string): HTMLElement {
  return el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0', gap: '6px' } }, [
    el('div', { class: 'tag', style: { alignSelf: 'flex-start' }, text: label }),
    viewport,
  ]);
}

function compareToggle(active: ProjectData | null): HTMLElement {
  const state = store.getState();
  const others = state.projects.filter((x) => x.id !== state.currentId);
  if (active) {
    return button('✕ 退出并排对比', () => store.setCompare(null));
  }
  const sel = el('select', {
    class: 'field-input',
    style: { minWidth: '200px' },
    on: { change: () => store.setCompare((sel as HTMLSelectElement).value || null) },
  }, [
    el('option', { attrs: { value: '' }, text: '选择对比方案…' }),
    ...others.map((o) => el('option', { attrs: { value: o.id }, text: o.name })),
  ]);
  return sel;
}

function checkboxRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'field', style: { flexDirection: 'row', alignItems: 'center', gap: '8px' } }, [input, el('span', { text: label })]);
}
