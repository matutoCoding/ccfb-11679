import './ui/styles.css';
import { el } from './ui/dom';
import { store, PageId } from './ui/store';
import { renderProjectsPage } from './ui/pages/projects';
import { renderTankPage } from './ui/pages/tank';
import { renderAquascapePage } from './ui/pages/aquascape';
import { renderViewpointPage } from './ui/pages/viewpoint';
import { renderDistortionPage } from './ui/pages/distortion';
import { renderSettingsPage } from './ui/pages/settings';

const NAV: ReadonlyArray<[PageId, string, string]> = [
  ['projects', '项目列表', '🗂️'],
  ['tank', '缸体设计', '🧊'],
  ['aquascape', '水景布置', '🐠'],
  ['viewpoint', '视点预览', '👁️'],
  ['distortion', '畸变分析', '📊'],
  ['settings', '设置', '⚙️'],
];

const pageRenderers: Record<PageId, (root: HTMLElement) => void> = {
  projects: renderProjectsPage,
  tank: renderTankPage,
  aquascape: renderAquascapePage,
  viewpoint: renderViewpointPage,
  distortion: renderDistortionPage,
  settings: renderSettingsPage,
};

// 页面级资源清理注册表: 渲染新页面前销毁上一页的 WebGPU 资源
const disposers = new Set<() => void>();
export function registerDisposer(fn: () => void): void {
  disposers.add(fn);
}
function disposePage(): void {
  disposers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  disposers.clear();
}

function render(): void {
  const app = document.getElementById('app')!;
  const state = store.getState();
  const current = store.current;

  const nav = el('nav', { class: 'nav' }, NAV.map(([id, name, icon]) =>
    el('a', {
      class: state.page === id ? 'active' : '',
      text: `${icon} ${name}`,
      on: { click: () => store.setPage(id) },
    })));

  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'logo', text: '🐟' }),
      el('div', {}, [
        el('div', { text: '亚克力缸体折射预览' }),
        el('small', { text: 'Refraction Studio · WebGPU' }),
      ]),
    ]),
    nav,
    current ? el('div', { class: 'project-chip', text: `当前: ${current.name}` }) : el('span'),
  ]);

  const main = el('main', { class: 'main' });
  app.replaceChildren(topbar, main);

  // 除项目列表页外, 没有项目时提示先创建
  if (state.page !== 'projects' && !current) {
    main.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'icon', text: '📭' }),
      el('p', { text: '还没有项目, 请先在项目列表创建一个缸体方案' }),
    ]));
    return;
  }

  // 销毁上一页的 WebGPU 资源, 再渲染新页面
  disposePage();
  const renderer = pageRenderers[state.page];
  if (renderer) renderer(main);
}

store.subscribe(render);
window.addEventListener('hashchange', () => store.applyHash());

// 启动
if (!location.hash) location.hash = 'projects';
store.applyHash();
render();
