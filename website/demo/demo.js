(() => {
  const labels = { overview: 'Growth overview', insights: 'Market discovery', competitors: 'Competitor intelligence', visibility: 'SEO & AI visibility', ads: 'Ads intelligence', content: 'Content studio', social: 'Social media', leads: 'Leads & CRM', actions: 'Actions & approvals', outcomes: 'Outcomes & reports' };
  document.querySelectorAll('[data-view]').forEach(control => {
    control.addEventListener('click', () => {
      const id = control.dataset.view;
      document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
      document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.view === id));
      document.querySelector('#title').textContent = labels[id];
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
