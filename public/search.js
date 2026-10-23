/* Keep the input mounted until the IME commits a complete character. */
function bindComposingSearch(input, update) {
  let composing = false;
  const apply = () => {
    const { id, value, selectionStart, selectionEnd, selectionDirection } = input;
    update(value);
    render();
    const next = document.getElementById(id);
    if (!next) return;
    next.focus();
    try { next.setSelectionRange(selectionStart, selectionEnd, selectionDirection); } catch {}
  };
  input.oncompositionstart = () => { composing = true; };
  input.oncompositionend = () => { composing = false; apply(); };
  input.oninput = event => {
    if (!composing && !event.isComposing) apply();
  };
}
