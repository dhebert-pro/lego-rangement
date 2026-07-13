(() => {
  const hover = document.createElement('div');
  hover.className = 'image-hover-preview';
  hover.hidden = true;
  hover.innerHTML = '<img alt="Aperçu agrandi">';

  const lightbox = document.createElement('div');
  lightbox.className = 'image-lightbox';
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Image agrandie');
  lightbox.innerHTML = '<button type="button" aria-label="Fermer l’image agrandie">×</button><img alt="Aperçu agrandi">';
  document.body.append(hover, lightbox);

  const sourceOf = image => image.currentSrc || image.src;
  const hideHover = () => { hover.hidden = true; };
  const close = () => { lightbox.hidden = true; };

  document.addEventListener('pointerover', event => {
    const image = event.target.closest?.('img[data-preview]');
    if (!image || event.pointerType === 'touch' || !matchMedia('(hover: hover)').matches) return;
    hover.querySelector('img').src = sourceOf(image);
    const rect = image.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const left = rect.right + width + 18 <= window.innerWidth ? rect.right + 12 : Math.max(12, rect.left - width - 12);
    const top = Math.max(12, Math.min(window.innerHeight - width - 12, rect.top + rect.height / 2 - width / 2));
    hover.style.width = `${width}px`;
    hover.style.height = `${width}px`;
    hover.style.left = `${left}px`;
    hover.style.top = `${top}px`;
    hover.hidden = false;
  });

  document.addEventListener('pointerout', event => {
    if (event.target.closest?.('img[data-preview]')) hideHover();
  });

  document.addEventListener('click', event => {
    const image = event.target.closest?.('img[data-preview]');
    if (!image) return;
    hideHover();
    lightbox.querySelector('img').src = sourceOf(image);
    lightbox.hidden = false;
  });

  lightbox.addEventListener('click', event => { if (event.target === lightbox || event.target.closest('button')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideHover(); close(); } });
})();
