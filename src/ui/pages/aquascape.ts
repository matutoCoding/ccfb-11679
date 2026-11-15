import { el, mount, button, sliderField, toast } from '../dom';
import { store } from '../store';
import { createId } from '../../core/storage';
import { FishSchool, Rock } from '../../core/types';

export function renderAquascapePage(root: HTMLElement): void {
  const p = store.current!;
  const patch = store.patchCurrent.bind(store);

  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '水景布置' }),
    el('p', { text: '配置鱼群巡游与礁石; 背景参考网格用于畸变分析的基准对齐。' }),
  ]);

  const gridCard = el('div', { class: 'card' }, [
    el('h3', { text: '背景参考网格' }),
    sliderField('网格距内壁距离', p.aquascape.referenceDistance, 'm', 0.1, 3, 0.05,
      (v) => patch((d) => { d.aquascape.referenceDistance = v; })),
    sliderField('网格密度', p.aquascape.gridDensity, '格/m', 1, 12, 1,
      (v) => patch((d) => { d.aquascape.gridDensity = v; })),
  ]);

  const fishCards = p.aquascape.schools.map((s, idx) => fishCard(s, idx, patch));
  const fishSection = el('div', { class: 'card' }, [
    el('h3', { text: `鱼群 (${p.aquascape.schools.length})` }),
    el('div', { class: 'grid' }, fishCards),
    button('＋ 添加鱼群', () => patch((d) => {
      d.aquascape.schools.push({
        id: createId(), name: `鱼群 ${d.aquascape.schools.length + 1}`, count: 30,
        center: [0, 1.2, -2], swimRadius: 1, swimSpeed: 0.15, fishLength: 0.25, color: '#ff9d3c',
      });
    }), 'primary'),
  ]);

  const rockCards = p.aquascape.rocks.map((r, idx) => rockCard(r, idx, patch));
  const rockSection = el('div', { class: 'card' }, [
    el('h3', { text: `礁石 (${p.aquascape.rocks.length})` }),
    el('div', { class: 'grid cols-2' }, rockCards),
    button('＋ 添加礁石', () => patch((d) => {
      d.aquascape.rocks.push({
        id: createId(), name: `礁石 ${d.aquascape.rocks.length + 1}`,
        position: [0, 0.3, -2], scale: [0.6, 0.5, 0.6], color: '#8a8f98',
      });
    }), 'primary'),
  ]);

  mount(root, [head, gridCard, fishSection, rockSection]);
}

function fishCard(s: FishSchool, idx: number, patch: (m: (d: import('../../core/types').ProjectData) => void) => void): HTMLElement {
  const update = (fn: (x: FishSchool) => void) =>
    patch((d) => fn(d.aquascape.schools[idx]));
  const colorInput = el('input', {
    attrs: { type: 'color', value: s.color },
    on: { change: () => update((x) => { x.color = (colorInput as HTMLInputElement).value; }) },
  });
  return el('div', { class: 'ray-report' }, [
    el('div', { class: 'btn-row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, [
      el('strong', { text: s.name }),
      button('删除', () => patch((d) => { d.aquascape.schools = d.aquascape.schools.filter((x) => x.id !== s.id); toast('已删除鱼群'); }), 'danger'),
    ]),
    nameEdit(s.name, (v) => update((x) => { x.name = v; })),
    sliderField('数量', s.count, '条', 1, 200, 1, (v) => update((x) => { x.count = v; })),
    sliderField('巡游半径', s.swimRadius, 'm', 0.2, 4, 0.1, (v) => update((x) => { x.swimRadius = v; })),
    sliderField('巡游速度', s.swimSpeed, '圈/s', 0, 1, 0.01, (v) => update((x) => { x.swimSpeed = v; })),
    sliderField('鱼体长度', s.fishLength, 'm', 0.05, 1, 0.01, (v) => update((x) => { x.fishLength = v; })),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: '颜色' }), colorInput]),
    el('div', { class: 'muted mono', style: { fontSize: '12px' }, text: `中心 (${s.center.map((c) => c.toFixed(2)).join(', ')}) m` }),
  ]);
}

function nameEdit(value: string, onChange: (v: string) => void): HTMLElement {
  const input = el('input', { class: 'field-input', attrs: { value }, on: { change: () => onChange((input as HTMLInputElement).value) } });
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: '名称' }), input]);
}

function rockCard(r: Rock, idx: number, patch: (m: (d: import('../../core/types').ProjectData) => void) => void): HTMLElement {
  const update = (fn: (x: Rock) => void) =>
    patch((d) => fn(d.aquascape.rocks[idx]));
  const colorInput = el('input', {
    attrs: { type: 'color', value: r.color },
    on: { change: () => update((x) => { x.color = (colorInput as HTMLInputElement).value; }) },
  });
  return el('div', { class: 'ray-report' }, [
    el('div', { class: 'btn-row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, [
      el('strong', { text: r.name }),
      button('删除', () => patch((d) => { d.aquascape.rocks = d.aquascape.rocks.filter((x) => x.id !== r.id); }), 'danger'),
    ]),
    nameEdit(r.name, (v) => update((x) => { x.name = v; })),
    sliderField('位置 X', r.position[0], 'm', -8, 8, 0.1, (v) => update((x) => { x.position[0] = v; })),
    sliderField('位置 Y', r.position[1], 'm', 0, 6, 0.1, (v) => update((x) => { x.position[1] = v; })),
    sliderField('位置 Z', r.position[2], 'm', -8, 2, 0.1, (v) => update((x) => { x.position[2] = v; })),
    sliderField('尺寸 X', r.scale[0], 'm', 0.1, 3, 0.05, (v) => update((x) => { x.scale[0] = v; })),
    sliderField('尺寸 Y', r.scale[1], 'm', 0.1, 3, 0.05, (v) => update((x) => { x.scale[1] = v; })),
    sliderField('尺寸 Z', r.scale[2], 'm', 0.1, 3, 0.05, (v) => update((x) => { x.scale[2] = v; })),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: '颜色' }), colorInput]),
  ]);
}
