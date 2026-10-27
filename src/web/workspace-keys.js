// Event normalization only; Bend owns navigation order and action decisions.
export function workspaceShortcut(event, platform = '') {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null;
  const key = event.key?.toLowerCase(), mac = /mac/i.test(platform);
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // Explicit command entry/toggle chords also work from an editor or PTY.
  if (command && event.shiftKey && !event.altKey && key === 'p') return ['ws-palette-open', ''];
  if (!mac && event.metaKey && !event.ctrlKey && !event.altKey &&
      (event.code === 'Backquote' || key === '`' || key === '~')) return ['ws-key', 'term'];
  if (command && !event.shiftKey && !event.altKey && key === 'j') return ['ws-key', 'term'];
  if (command && !event.shiftKey && !event.altKey && key === 'b') return ['side-toggle', ''];
  const editor = event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-keys],[data-keyto]');
  // The requested bare backtick works from the composer/workspace. Keep
  // literal backticks available in shells and other text fields.
  if (key === '`' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      (!editor || (editor.tagName === 'TEXTAREA' && editor.id === 'composer' &&
        !editor.hasAttribute?.('data-keys') && !editor.hasAttribute?.('data-keyto')))) return ['ws-key', 'term'];
  if (editor) return null;
  if (command && !event.altKey && event.shiftKey) {
    if (key === 'u') return ['ws-key', 'uber'];
    if (event.code === 'BracketLeft' || key === '[' || key === '{') return ['ws-key', 'prev'];
    if (event.code === 'BracketRight' || key === ']' || key === '}') return ['ws-key', 'next'];
    if (key === 's') return ['ws-key', 'settle'];
    if (key === 'f') return ['thin-search-open', ''];
  }
  if (command && !event.altKey && !event.shiftKey) {
    const action = { k: 'palette', n: 'new', d: 'diff', p: 'files' }[key];
    if (action) return ['ws-key', action];
    if (/^[1-9]$/.test(key)) return ['ws-key', 'ctrl+' + key];
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && /^[1-9]$/.test(key)) return ['ws-key', 'alt+' + key];
  return null;
}

export function installWorkspaceKeys({ dispatch, document: doc = document, platform = navigator.platform }) {
  doc.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (doc.querySelector('.tour,.lightbox')) return; // The active overlay owns every key.
    const palette = doc.querySelector('.workspace-palette');
    if (palette) {
      const action = { Escape: 'ws-palette-close', Enter: 'ws-palette-enter', ArrowUp: 'ws-palette-move', ArrowDown: 'ws-palette-move' }[event.key];
      if (action && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault(); event.stopImmediatePropagation();
        dispatch(action, event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : ''); return;
      }
      if (event.key === 'Tab') {
        const fields = [...palette.querySelectorAll('input,button')];
        const at = fields.indexOf(doc.activeElement), next = (at + (event.shiftKey ? -1 : 1) + fields.length) % fields.length;
        if (fields.length) { event.preventDefault(); event.stopImmediatePropagation();fields[next].focus(); }
        return;
      }
    }
    // Match the native composer: Escape leaves it once completions are closed.
    // Keep editor navigation guarded until focus has actually left the field.
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        event.target?.tagName === 'TEXTAREA' && event.target.id === 'composer' &&
        !event.target.getAttribute?.('data-esc')) {
      event.preventDefault(); event.stopImmediatePropagation(); event.target.blur(); return;
    }
    const action = workspaceShortcut(event, platform);
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat && (action[0] === 'ws-palette-open' || action[1] === 'palette' || action[1] === 'term')) return;
    dispatch(...action);
  }, true);
}
