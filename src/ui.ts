// Sliders you can drag while the thing moves. No play button — it never stops.

export function group(parent: HTMLElement, title: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'group';
  const h = document.createElement('h2');
  h.textContent = title;
  g.appendChild(h);
  parent.appendChild(g);
  return g;
}

export function slider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): (v: number) => void {
  const row = document.createElement('label');
  row.className = 'row';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const val = document.createElement('em');
  const fmt = (v: number) => (step < 0.01 ? v.toFixed(3) : v.toFixed(2));
  val.textContent = fmt(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  row.append(name, input, val);
  parent.appendChild(row);
  return (v: number) => {
    input.value = String(v);
    val.textContent = fmt(v);
  };
}
