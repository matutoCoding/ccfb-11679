import { el, mount, button, sliderField, selectField, toast, download } from '../dom';
import { store } from '../store';
import { registerDisposer } from '../../main';
import { DistortionAnalyzer, DistortionResult } from '../../gpu/DistortionAnalyzer';
import { RefractionRenderer } from '../../gpu/RefractionRenderer';

// 蓝→青→绿→黄→红 的热力色带
function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [30, 58, 138]],
    [0.25, [14, 165, 233]],
    [0.5, [52, 211, 153]],
    [0.75, [251, 191, 36]],
    [1, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const k = (x - t0) / (t1 - t0);
      const c = c0.map((a, j) => Math.round(a + (c1[j] - a) * k));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(239,68,68)';
}

export function renderDistortionPage(root: HTMLElement): void {
  const p = store.current!;
  const patch = store.patchCurrent.bind(store);

  const head = el('div', { class: 'page-head' }, [
    el('h2', { text: '畸变分析' }),
    el('p', { text: '对缸后参考网格逐节点追迹折射光路, 输出偏移量与局部放大率着色图, 数据可导出 CSV。' }),
  ]);

  const controls = el('div', { class: 'card' }, [
    el('h3', { text: '分析参数' }),
    selectField<'offset' | 'magnification'>('着色度量', p.distortion.metric, [
      ['offset', '偏移量 (毫米)'],
      ['magnification', '放大率'],
    ], (v) => patch((d) => { d.distortion.metric = v; })),
    sliderField('网格分辨率', p.distortion.gridResolution, '格/边', 8, 128, 8,
      (v) => patch((d) => { d.distortion.gridResolution = v; })),
    sliderField('偏移量色带上限', p.distortion.offsetMaxMm, 'mm', 1, 100, 1,
      (v) => patch((d) => { d.distortion.offsetMaxMm = v; })),
  ]);

  const heatHost = el('div', {}, []);
  const statsHost = el('div', {}, []);
  const resultCard = el('div', { class: 'card' }, [
    el('h3', { text: '畸变热力图' }),
    heatHost,
    el('div', { class: 'legend' }, [
      el('span', { text: '低' }), el('div', { class: 'bar' }), el('span', { text: '高' }),
    ]),
    statsHost,
    el('div', { class: 'btn-row', style: { marginTop: '16px' } }, [
      button('⬇ 导出畸变数据 CSV', () => {
        if (!lastResult) { toast('请先运行分析', 'error'); return; }
        download(`distortion-${p.name}-${Date.now()}.csv`, DistortionAnalyzer.toCsv(lastResult), 'text/csv');
        toast('已导出 CSV', 'success');
      }, 'primary'),
    ]),
  ]);

  const status = el('p', { class: 'muted', text: '点击"运行分析"开始 GPU 计算' });
  const runBtn = button('▶ 运行畸变分析', () => void run(), 'primary');
  const toolbar = el('div', { class: 'toolbar' }, [runBtn, status]);

  let analyzer: DistortionAnalyzer | null = null;
  let lastResult: DistortionResult | null = null;
  let disposed = false;

  async function run(): Promise<void> {
    if (!RefractionRenderer.isSupported()) {
      toast('浏览器不支持 WebGPU, 无法运行 GPU 分析', 'error');
      return;
    }
    status.textContent = '计算中…';
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('无 GPU 适配器');
      const device = await adapter.requestDevice();
      analyzer?.destroy();
      analyzer = new DistortionAnalyzer(device, 128);
      const proj = store.current!;
      lastResult = await analyzer.analyze(proj);
      if (disposed) { analyzer.destroy(); return; }
      renderResult(lastResult, proj.distortion.metric, proj.distortion.offsetMaxMm);
      status.textContent = `完成: ${lastResult.n}×${lastResult.n} 网格`;
      device.destroy();
    } catch (err) {
      status.textContent = '分析失败';
      toast(err instanceof Error ? err.message : '分析失败', 'error');
    }
  }

  function renderResult(result: DistortionResult, metric: 'offset' | 'magnification', offsetMax: number): void {
    const n = result.n;
    const grid = el('div', { class: 'heatmap', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
    const cells: HTMLElement[] = [];
    for (const c of result.cells) {
      const t = metric === 'offset'
        ? c.offsetMm / offsetMax
        : Math.max(0, (c.magnification - 0.7) / 0.6); // 放大率 0.7~1.3 映射到色带
      cells.push(el('div', { class: 'cell', attrs: { title: `偏移 ${c.offsetMm.toFixed(3)} mm, 放大率 ${c.magnification.toFixed(3)}` }, style: { background: heatColor(t) } }));
    }
    grid.replaceChildren(...cells);
    heatHost.replaceChildren(grid);

    const s = metric === 'offset' ? result.offsetStats : null;
    statsHost.replaceChildren(el('div', { class: 'stat-grid' }, [
      stat('偏移最小值', s ? `${s.min.toFixed(3)} mm` : '—'),
      stat('偏移最大值', s ? `${s.max.toFixed(3)} mm` : '—'),
      stat('偏移均值', s ? `${s.mean.toFixed(3)} mm` : '—'),
      stat('偏移 RMS', s ? `${s.rms.toFixed(3)} mm` : '—'),
      stat('放大率 min', result.magStats.min.toFixed(3)),
      stat('放大率 max', result.magStats.max.toFixed(3)),
      stat('放大率均值', result.magStats.mean.toFixed(3)),
    ]));
  }

  function stat(k: string, v: string): HTMLElement {
    return el('div', { class: 'stat' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v mono', text: v })]);
  }

  registerDisposer(() => { disposed = true; analyzer?.destroy(); });

  mount(root, [head, toolbar, el('div', { class: 'grid cols-2' }, [controls, resultCard])]);
}
