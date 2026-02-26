// Tab switching for the landing page.

document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  function activate(tabId) {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    contents.forEach(c => c.classList.toggle('active', c.id === tabId));

    // Lazy-load demo iframe on first activation
    if (tabId === 'demo') {
      const iframe = document.getElementById('demo-iframe');
      if (iframe && !iframe.src) {
        iframe.src = 'demo/index.html';
      }
    }
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  // Back button exits demo tab
  const backBtn = document.getElementById('demo-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => activate('abstract'));
  }
});
