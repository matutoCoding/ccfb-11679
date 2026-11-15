import { el, mount, button, toast, download } from '../dom';
import { store } from '../store';
import { exportProjects, parseImport } from '../../core/storage';
import { ProjectData, TankKind } from '../../core/types';
import { waterIorAt } from '../../core/waterIor';

const KIND_NAME: Record<TankKind, string> = {
  planar: '平面缸',
  cylinder: '圆柱缸',
  tunnel: '隧道拱形',
};

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function renderProjectsPage(root: HTMLElement): void {
  const state = store.getState();

  const importInput = el('input', {
    attrs: { type: 'file', accept: '.json,application/json' },
    style: { display: 'none' },
    on: {
      change: async () => {
        const input = importInput as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const imported = parseImport(text);
          // 导入项目重新分配 id, 避免与现有项目冲突
          const merged = [...store.getState().projects];
          for (const p of imported) {
            merged.push({ ...p, id: crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.random()}` });
          }
          store.replaceAll(merged);
          toast(`成功导入 ${imported.length} 个项目`, 'success');
        } catch (err) {
          toast(err instanceof Error ? err.message : '导入失败', 'error');
        }
        input.value = '';
      },
    },
  }) as HTMLInputElement;

  const toolbar = el('div', { class: 'toolbar' }, [
    button('＋ 新建缸体方案', () => {
      const p = store.addProject();
      store.selectProject(p.id);
      store.setPage('tank');
    }, 'primary'),
    button('导出全部项目 (JSON)', () => {
      const env = exportProjects(store.getState().projects);
      download(`aquarium-projects-${Date.now()}.json`, JSON.stringify(env, null, 2), 'application/json');
      toast('已导出全部项目', 'success');
    }),
    button('导入项目 (JSON)', () => importInput.click()),
    importInput,
  ]);

  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '项目列表' }),
    el('p', { text: `共 ${state.projects.length} 个缸体方案, 数据保存在本浏览器 localStorage` }),
  ]);

  if (state.projects.length === 0) {
    mount(root, [head, toolbar, el('div', { class: 'empty' }, [
      el('div', { class: 'icon', text: '🐠' }),
      el('p', { text: '还没有项目, 点击右上角"新建缸体方案"开始' }),
    ])]);
    return;
  }

  const cards = state.projects.map((p) => projectCard(p));
  mount(root, [head, toolbar, el('div', { class: 'grid cols-2' }, cards)]);
}

function projectCard(p: ProjectData): HTMLElement {
  const nWater = p.optics.waterIorOverride ?? waterIorAt(p.optics.waterTemperature);
  const card = el('div', { class: 'card clickable', on: { click: () => { store.selectProject(p.id); store.setPage('tank'); } } }, [
    el('div', { class: 'btn-row', style: { justifyContent: 'space-between' } }, [
      el('h3', { text: p.name }),
      el('span', { class: 'tag', text: KIND_NAME[p.geometry.kind] }),
    ]),
    el('div', { class: 'meta', style: { display: 'grid', gap: '4px', marginTop: '10px' } }, [
      el('span', { html: `壁厚 <b class="mono">${(p.geometry.wallThickness * 1000).toFixed(1)} mm</b>` }),
      el('span', { html: `水折射率 <b class="mono">${nWater.toFixed(5)}</b> @ ${p.optics.waterTemperature}°C` }),
      el('span', { html: `亚克力 n=<b class="mono">${p.optics.acrylicIor}</b>` }),
      el('span', { text: `鱼群 ${p.aquascape.schools.length} · 礁石 ${p.aquascape.rocks.length}` }),
      el('span', { class: 'muted', text: `更新于 ${fmtDate(p.updatedAt)}` }),
    ]),
    el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
      button('打开', () => { store.selectProject(p.id); store.setPage('viewpoint'); }, 'primary'),
      button('重命名', () => renameDialog(p)),
      button('复制', () => { store.duplicateProject(p.id); toast('已复制项目', 'success'); }),
      button('导出', () => {
        const env = exportProjects([p]);
        download(`${p.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify(env, null, 2), 'application/json');
      }),
      button('删除', () => confirmDelete(p), 'danger'),
    ]),
  ]);
  return card;
}

function renameDialog(p: ProjectData): void {
  const input = el('input', { class: 'field-input', attrs: { value: p.name } }) as HTMLInputElement;
  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h3', { text: '重命名项目' }),
      input,
      el('div', { class: 'btn-row', style: { marginTop: '16px', justifyContent: 'flex-end' } }, [
        button('取消', () => backdrop.remove()),
        button('保存', () => {
          const name = input.value.trim();
          if (name) { store.updateProject(p.id, { name }); toast('已重命名', 'success'); }
          backdrop.remove();
        }, 'primary'),
      ]),
    ]),
  ]);
  document.body.appendChild(backdrop);
  input.focus();
  input.select();
}

function confirmDelete(p: ProjectData): void {
  const backdrop = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('h3', { text: `删除「${p.name}」?` }),
      el('p', { class: 'muted', text: '该操作不可撤销, 项目的全部配置将被清除。' }),
      el('div', { class: 'btn-row', style: { marginTop: '16px', justifyContent: 'flex-end' } }, [
        button('取消', () => backdrop.remove()),
        button('确认删除', () => { store.deleteProject(p.id); toast('已删除', 'success'); backdrop.remove(); }, 'danger'),
      ]),
    ]),
  ]);
  document.body.appendChild(backdrop);
}
