// Image operations export pixels, never a hub URL, cookie or bearer token.
// Kept separate from the zoom/pan model so gestures remain unchanged.
export function imagePng(img) {
  const { naturalWidth: width, naturalHeight: height } = img;
  if (!width || !height) throw Error('Image has not loaded');
  if (width * height > 32 * 1024 * 1024) throw Error('Image is too large to copy');
  const canvas = document.createElement('canvas');
  canvas.width = width;canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

export function installImageActions(el, img, source, native = window.backplaneDesktop?.image) {
  const status = el.querySelector('[data-lb-status]');
  const copy = el.querySelector('[data-lb-copy]');
  const reveal = el.querySelector('[data-lb-reveal]');
  const save = el.querySelector('[data-lb-save]');
  const share = el.querySelector('[data-lb-share]');
  const say = text => { status.textContent = text; };
  const blob = () => new Promise((resolve, reject) => {
    try { imagePng(img).toBlob(value => value ? resolve(value) : reject(Error('Could not prepare image')), 'image/png'); }
    catch { reject(Error('Image pixels are unavailable. Try the browser’s image menu.')); }
  });
  const ready = () => { copy.disabled = save.disabled = share.disabled = !img.naturalWidth; };
  img.addEventListener('load', ready);
  img.addEventListener('error', () => { ready();say('Image could not be loaded.'); });
  ready();
  reveal.hidden = true;
  // The native bridge validates the selected local service origin. Web and
  // other-machine images never acquire a local file-system action by parsing
  // their URL in the renderer.
  if (native?.local) void native.local(source).then(local => { if (el.isConnected) reveal.hidden = !local; }).catch(() => {});
  copy.addEventListener('click', async () => {
    say('');
    try {
      if (native?.copy) {
        const result = await native.copy(imagePng(img).toDataURL('image/png'));
        if (!result?.copied) throw Error('Clipboard did not accept the image');
      } else {
        if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw Error('Image clipboard is unavailable here. Use the browser’s image menu or Save.');
        // Invoke write during the click: Safari's user activation must not be
        // spent awaiting canvas encoding or a permissions request first.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
      }
      say('Image copied.');
    } catch (error) { say(error?.message || 'Image could not be copied.'); }
  });
  reveal.addEventListener('click', async () => {
    say('');
    try {
      const result = await native.reveal(source);
      say(result?.accepted ? 'File manager accepted the reveal request.' : result?.requested ? 'Reveal requested.' : 'File could not be revealed.');
    } catch { say('File could not be revealed. It may be missing, or the file manager is unavailable.'); }
  });
  save.addEventListener('click', async () => {
    say('');
    try {
      const url = URL.createObjectURL(await blob()), link = document.createElement('a');
      link.href = url;link.download = 'image.png';link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // A browser download has no completion acknowledgement.
    } catch (error) { say(error?.message || 'Image could not be saved.'); }
  });
  share.hidden = !navigator.canShare || !navigator.share;
  share.addEventListener('click', async () => {
    say('');
    try {
      const file = new File([await blob()], 'image.png', { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) throw Error('Image sharing is unavailable here. Use Save.');
      await navigator.share({ files: [file] });
    } catch (error) { if (error?.name !== 'AbortError') say(error?.message || 'Image could not be shared.'); }
  });
}
