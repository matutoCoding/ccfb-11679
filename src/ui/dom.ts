// 极简 DOM 构建辅助, 避免引入框架; 支持元素创建、样式与事件绑定。
export type ElProps = {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  value?: string | number;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  on?: Record<string, EventListenerOrEventListenerObject>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = String(props.text);
  if (props.html !== undefined) node.innerHTML = String(props.html);
  if (props.value !== undefined) (node as HTMLInputElement).value = String(props.value);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, String(v));
  if (props.style) Object.assign(node.style, props.style);
  if (props.on) for (const [evt, fn] of Object.entries(props.on)) node.addEventListener(evt, fn);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function mount(node: HTMLElement, children: (Node | null | undefined | false)[]): void {
  node.replaceChildren(...(children.filter(Boolean) as Node[]));
}

/** 数字输入框(带标签、单位、范围) */
export function numberField(
  label: string,
  value: number,
  unit: string,
  onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLElement {
  const input = el('input', {
    class: 'field-input',
    attrs: { type: 'number', ...(opts.min !== undefined ? { min: String(opts.min) } : {}), ...(opts.max !== undefined ? { max: String(opts.max) } : {}), ...(opts.step !== undefined ? { step: String(opts.step) } : {}) },
    value,
    on: {
      change: () => {
        const v = parseFloat((input as HTMLInputElement).value);
        if (Number.isFinite(v)) onChange(v);
      },
    },
  }) as HTMLInputElement;
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    el('div', { class: 'field-row' }, [input, el('span', { class: 'field-unit', text: unit })]),
  ]);
}

/** 滑块 + 数字联动 */
export function sliderField(
  label: string,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement {
  const num = el('input', { attrs: { type: 'number', min: String(min), max: String(max), step: String(step) }, class: 'field-input small', value }) as HTMLInputElement;
  const range = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) }, class: 'field-range', value }) as HTMLInputElement;
  const sync = (v: number) => { num.value = String(v); range.value = String(v); onChange(v); };
  num.addEventListener('change', () => { const v = parseFloat(num.value); if (Number.isFinite(v)) sync(v); });
  range.addEventListener('input', () => sync(parseFloat(range.value)));
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: `${label} (${unit})` }),
    el('div', { class: 'field-row' }, [range, num]),
  ]);
}

export function selectField<T extends string>(
  label: string,
  value: T,
  options: ReadonlyArray<readonly [T, string]>,
  onChange: (v: T) => void,
): HTMLElement {
  const sel = el('select', {
    class: 'field-input',
    on: { change: () => onChange((sel as HTMLSelectElement).value as T) },
  }, options.map(([val, name]) => el('option', { attrs: { value: val }, text: name, ...(val === value ? { attrs: { value: val, selected: 'selected' } } : {}) }))) as HTMLSelectElement;
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), sel]);
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  return el('button', { class: `btn btn-${kind}`, text: label, on: { click: onClick } }) as HTMLButtonElement;
}

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const t = el('div', { class: `toast toast-${kind}`, text: message });
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.appendChild(host);
  }
  host.appendChild(t);
  setTimeout(() => { t.classList.add('show'); }, 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

export function download(filename: string, content: string | Blob, mime = 'application/octet-stream'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { attrs: { href: url, download: filename } }) as HTMLAnchorElement;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
