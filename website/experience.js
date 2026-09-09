(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reduced.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('main > section:not(:first-child) .nm-reading, main .nm-card, .me-ecosystem-heading').forEach(el => {
      el.classList.add('me-reveal');
      observer.observe(el);
    });
  }
  const hero = document.querySelector('.nm-hero, .nm-cn-hero');
  let frame = 0;
  if (hero && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    hero.addEventListener('pointermove', event => {
      if (reduced.matches || frame) return;
      frame = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        hero.style.setProperty('--glow-x', `${100 * (event.clientX - rect.left) / rect.width}%`);
        hero.style.setProperty('--glow-y', `${100 * (event.clientY - rect.top) / rect.height}%`);
        frame = 0;
      });
    });
  }
  document.querySelectorAll('[data-demo]').forEach(demo => {
    const form = demo.querySelector('form');
    const button = form.querySelector('button');
    const status = demo.querySelector('[role="status"]');
    const steps = [...demo.querySelectorAll('li')];
    const zh = demo.dataset.lang === 'zh';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (button.disabled) return;
      const market = form.querySelector('input').value.trim();
      if (!market) { form.querySelector('input').focus(); return; }
      button.disabled = true;
      steps.forEach(step => step.classList.remove('is-active', 'is-done'));
      const messages = zh
        ? [`示例：为${market}整理客户与竞品问题。`, '示例：优先改进落地页，再小范围测试内容。', '示例：约定询盘指标和复盘时间，不预设增长。']
        : [`Example: frame customer and competitor questions for ${market}.`, 'Example: improve the landing page, then test content on a small scale.', 'Example: agree enquiry measures and a review date without assuming growth.'];
      for (let i = 0; i < steps.length; i++) {
        steps[i].classList.add('is-active');
        status.textContent = messages[i];
        await new Promise(resolve => setTimeout(resolve, reduced.matches ? 0 : 1300));
        steps[i].classList.remove('is-active');
        steps[i].classList.add('is-done');
      }
      status.textContent = zh ? '演示结束。实际项目会先确认数据、交付范围与审批。' : 'Demo complete. Real projects begin with agreed data, scope and approvals.';
      button.disabled = false;
    });
  });
})();
