import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('한글 조합 중에는 검색 화면을 교체하지 않고 완성 후 검색한다', async () => {
  const source = await readFile(new URL('../public/search.js', import.meta.url), 'utf8');
  let renders = 0, query = '', focused = false, selection;
  const next = { focus() { focused = true; }, setSelectionRange(...args) { selection = args; } };
  const context = { render() { renders++; }, document: { getElementById() { return next; } } };
  runInNewContext(source, context);
  const input = { id: 'teacher-student-search', value: 'ㅈ', selectionStart: 1, selectionEnd: 1, selectionDirection: 'none' };
  context.bindComposingSearch(input, value => { query = value; });
  input.oncompositionstart();
  input.oninput({ isComposing: true });
  input.value = '자';
  input.oninput({ isComposing: false });
  assert.equal(renders, 0);
  input.oncompositionend();
  assert.equal(renders, 1);
  assert.equal(query, '자');
  assert.equal(focused, true);
  assert.deepEqual(selection, [1, 1, 'none']);
  input.value = '';
  input.oninput({ isComposing: false });
  assert.equal(query, '');
  assert.equal(renders, 2);
});
