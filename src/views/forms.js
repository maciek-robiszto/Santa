import { html } from '../html.js';

export function input({ label, name, value = '', type = 'text', required = false, hint, error, autocomplete, max, min }) {
  const id = `f-${name}`;
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="${id}">${label}${required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
    <input id="${id}" name="${name}" type="${type}" value="${value ?? ''}" ${required ? html`required` : ''}
      ${autocomplete ? html`autocomplete="${autocomplete}"` : ''} ${max ? html`maxlength="${max}"` : ''} ${min ? html`minlength="${min}"` : ''}
      ${hint || error ? html`aria-describedby="${id}-hint"` : ''}>
    ${error ? html`<p class="error" id="${id}-hint">${error}</p>` : hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
  </div>`;
}

export function textarea({ label, name, value = '', hint, error, max, rows = 4, required = false }) {
  const id = `f-${name}`;
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="${id}">${label}${required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
    <textarea id="${id}" name="${name}" rows="${rows}" ${max ? html`maxlength="${max}" data-counter` : ''} ${required ? html`required` : ''}
      ${hint || error ? html`aria-describedby="${id}-hint"` : ''}>${value ?? ''}</textarea>
    ${error ? html`<p class="error" id="${id}-hint">${error}</p>` : hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
  </div>`;
}

export function checkbox({ label, name, checked, hint }) {
  return html`<div class="field check">
    <label><input type="checkbox" name="${name}" value="1" ${checked ? html`checked` : ''}> ${label}</label>
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
  </div>`;
}
