document.querySelectorAll("[data-back-link]").forEach((link) => {
  if (!document.referrer) return;
  if (new URL(document.referrer).origin !== location.origin) return;

  link.addEventListener("click", (event) => {
    event.preventDefault();
    history.back();
  });
});
