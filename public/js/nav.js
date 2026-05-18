// Highlight active nav link based on current page
document.addEventListener('DOMContentLoaded', function () {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') && path.includes(link.getAttribute('href').replace('.html', ''))) {
      link.classList.add('active');
    }
  });
});
