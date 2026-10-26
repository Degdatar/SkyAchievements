(() => {
  const root = document.getElementById('notice');
  const icon = document.getElementById('notice-icon');
  const fallback = document.getElementById('notice-fallback');
  const name = document.getElementById('notice-name');
  const requirements = document.getElementById('notice-requirements');
  const designs = new Set(['celestial', 'dawnguard', 'arcane', 'minimal']);
  const sizes = new Set(['large', 'standard', 'compact']);
  const positions = new Set([
    'top-left', 'top-center', 'top-right', 'center-left', 'center-center', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right'
  ]);
  let hideTimer = 0;

  function hide() {
    window.clearTimeout(hideTimer);
    root.classList.remove('is-visible');
    window.skyrim?.skyos_skyachievements_notice_hide?.();
  }

  window.SkyAchievementNotice = {
    show(achievementName, requirementText, iconUrl, design, position, size, duration) {
      window.clearTimeout(hideTimer);
      const selectedDesign = designs.has(design) ? design : 'celestial';
      const selectedPosition = positions.has(position) ? position : 'top-center';
      const selectedSize = sizes.has(size) ? size : 'standard';
      root.className = `notice position-${selectedPosition} design-${selectedDesign} size-${selectedSize}`;
      name.textContent = String(achievementName || 'Achievement').slice(0, 160);
      requirements.textContent = String(requirementText || '').slice(0, 400);
      const source = String(iconUrl || '');
      if (source.startsWith('file:///') || source.startsWith('https://')) {
        icon.onload = () => { icon.hidden = false; fallback.hidden = true; };
        icon.onerror = () => { icon.hidden = true; fallback.hidden = false; };
        icon.src = source;
      } else {
        icon.removeAttribute('src');
        icon.hidden = true;
        fallback.hidden = false;
      }
      root.hidden = false;
      requestAnimationFrame(() => root.classList.add('is-visible'));
      const lifetime = Math.max(500, Math.min(10000, Number(duration) || 5200));
      hideTimer = window.setTimeout(hide, lifetime);
    }
  };
})();
