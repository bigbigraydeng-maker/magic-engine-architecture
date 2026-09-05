(() => {
  const mobileMenus = document.querySelectorAll('.nm-mobile');

  for (const menu of mobileMenus) {
    for (const link of menu.querySelectorAll('a')) {
      link.addEventListener('click', () => {
        menu.open = false;
      });
    }
  }
})();
