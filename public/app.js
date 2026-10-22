// Progressive enhancement only – everything works without JS.
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const input = document.querySelector(btn.getAttribute('data-copy'));
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  const label = btn.textContent;
  btn.textContent = 'Skopiowano ✓';
  setTimeout(() => { btn.textContent = label; }, 1500);
});

for (const ta of document.querySelectorAll('textarea[data-counter]')) {
  const max = Number(ta.getAttribute('maxlength'));
  const label = ta.closest('.field')?.querySelector('label');
  if (!label || !max) continue;
  const counter = document.createElement('span');
  counter.className = 'counter';
  label.append(counter);
  const update = () => { counter.textContent = `${ta.value.length}/${max}`; };
  ta.addEventListener('input', update);
  update();
}

document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
