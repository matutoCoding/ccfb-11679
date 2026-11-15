import { el, mount, sliderField, selectField, numberField, button } from '../dom';
import { store } from '../store';
import { TankKind, TankGeometry } from '../../core/types';
import { waterIorAt, WATER_IOR_TABLE } from '../../core/waterIor';

export function renderTankPage(root: HTMLElement): void {
  const p = store.current!;
  const g = p.geometry;
  const o = p.optics;

  const patch = store.patchCurrent.bind(store);

  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '缸体设计' }),
    el('p', { text: '选择缸体形式并调整壁厚与曲率; 水折射率随温度自动计算, 也可手动覆盖。' }),
  ]);

  const kindCard = el('div', { class: 'card' }, [
    el('h3', { text: '缸体形式' }),
    selectField<TankKind>('类型', g.kind, [
      ['planar', '平面缸 (直板亚克力)'],
      ['cylinder', '圆柱缸 (弧形环绕)'],
      ['tunnel', '隧道拱形 (游客在内部)'],
    ], (kind) => patch((d) => { d.geometry.kind = kind; })),
    kindHint(g.kind),
  ]);

  const geomCard = el('div', { class: 'card' }, [
    el('h3', { text: '几何参数' }),
    sliderField('亚克力壁厚', g.wallThickness * 1000, 'mm', 5, 300, 1,
      (v) => patch((d) => { d.geometry.wallThickness = v / 1000; })),
    g.kind === 'planar'
      ? numberField('面板宽度', g.width, 'm', (v) => patch((d) => { d.geometry.width = v; }), { min: 0.5, max: 30, step: 0.1 })
      : sliderField('外壁曲率半径 R', g.radius, 'm', 0.5, 15, 0.1,
        (v) => patch((d) => { d.geometry.radius = v; })),
    g.kind === 'planar'
      ? numberField('面板高度', g.height, 'm', (v) => patch((d) => { d.geometry.height = v; }), { min: 0.5, max: 20, step: 0.1 })
      : null,
    g.kind === 'tunnel'
      ? numberField('隧道跨度', g.tunnelSpan, 'm', (v) => patch((d) => { d.geometry.tunnelSpan = v; }), { min: 1, max: 20, step: 0.1 })
      : null,
    numberField('缸体纵深', g.depth, 'm', (v) => patch((d) => { d.geometry.depth = v; }), { min: 0.5, max: 30, step: 0.1 }),
    curvatureReadout(g),
  ]);

  const opticsCard = el('div', { class: 'card' }, [
    el('h3', { text: '光学参数' }),
    sliderField('水温', o.waterTemperature, '°C', 0, 60, 0.5,
      (v) => patch((d) => { d.optics.waterTemperature = v; })),
    el('div', { class: 'ray-report', style: { marginBottom: '14px' } }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'k', text: '自动水折射率 n水' }),
        el('span', { class: 'mono', text: waterIorAt(o.waterTemperature).toFixed(6) }),
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'k', text: '当前生效 n水' }),
        el('span', { class: 'mono pass', text: (o.waterIorOverride ?? waterIorAt(o.waterTemperature)).toFixed(6) }),
      ]),
    ]),
    numberField('亚克力折射率', o.acrylicIor, '', (v) => patch((d) => { d.optics.acrylicIor = v; }), { min: 1.3, max: 1.7, step: 0.001 }),
    numberField('空气折射率', o.airIor, '', (v) => patch((d) => { d.optics.airIor = v; }), { min: 1, max: 1.1, step: 0.0001 }),
    el('div', { class: 'btn-row' }, [
      button(o.waterIorOverride === null ? '手动覆盖 n水' : '恢复温度自动', () =>
        patch((d) => { d.optics.waterIorOverride = d.optics.waterIorOverride === null ? waterIorAt(d.optics.waterTemperature) : null; })),
    ]),
    o.waterIorOverride !== null
      ? numberField('手动 n水', o.waterIorOverride, '', (v) => patch((d) => { d.optics.waterIorOverride = v; }), { min: 1.2, max: 1.5, step: 0.0001 })
      : null,
  ]);

  const tableCard = el('div', { class: 'card' }, [
    el('h3', { text: '水折射率参考表 (589nm 实测)' }),
    el('div', { style: { maxHeight: '240px', overflow: 'auto' } }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '温度 °C' }), el('th', { text: '折射率 n' })])]),
        el('tbody', {}, WATER_IOR_TABLE.map(([T, n]) =>
          el('tr', {}, [el('td', { class: 'mono', text: String(T) }), el('td', { class: 'mono', text: n.toFixed(6) })]))),
      ]),
    ]),
  ]);

  mount(root, [
    head,
    el('div', { class: 'grid cols-2' }, [kindCard, geomCard, opticsCard, tableCard]),
  ]);
}

function kindHint(kind: TankKind): HTMLElement {
  const hints: Record<TankKind, string> = {
    planar: '平面直板: 畸变主要来自壁厚内的横向平移, 边缘入射角增大时偏移上升。',
    cylinder: '圆柱弧形: 曲率产生放大/缩小效应, 越靠近缸体两侧畸变越明显。',
    tunnel: '隧道拱形: 游客在水体内部向外看, 光路方向与外看相反, 需关注全反射临界角。',
  };
  return el('p', { class: 'muted', style: { marginTop: '10px', fontSize: '13px' }, text: hints[kind] });
}

function curvatureReadout(g: TankGeometry): HTMLElement {
  const curvature = g.kind === 'planar' ? 0 : 1 / g.radius;
  return el('div', { class: 'ray-report', style: { marginTop: '6px' } }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: '曲率 1/R' }),
      el('span', { class: 'mono', text: g.kind === 'planar' ? '0 (平面)' : `${curvature.toFixed(4)} /m` }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'k', text: '内壁半径' }),
      el('span', { class: 'mono', text: g.kind === 'planar' ? '—' : `${(g.radius - g.wallThickness).toFixed(3)} m` }),
    ]),
  ]);
}
