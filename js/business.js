/* The legal details shown on the landing page, the sign-up forms and the legal pages.
   Fill these in ONCE with your real registered business details before you go live.
   Anything left empty is shown as a highlighted "not set" marker, so it is never mistaken for a real value. */
window.FF_BUSINESS = {
  name: '',          // registered business name, e.g. "Acme Technologies Ltd"
  supportEmail: '',  // where schools and parents get help
  dpoEmail: '',      // Data Protection Officer / privacy contact
  address: '',       // postal or registered office address
  odpcReg: ''        // ODPC registration certificate number, once issued
};
(function () {
  function fill() {
    document.querySelectorAll('[data-biz]').forEach(function (el) {
      var key = el.getAttribute('data-biz');
      var v = (window.FF_BUSINESS && window.FF_BUSINESS[key]) || '';
      if (v) { el.textContent = v; el.classList.remove('ff-todo'); }
      else { el.textContent = '[' + key + ' not set]'; el.classList.add('ff-todo'); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
})();
