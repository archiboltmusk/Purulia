// Theme before first paint: white unless the visitor chose dark. The choice is kept per device.
(function () {
  var t = 'light';
  try {
    var s = localStorage.getItem('parishkar_theme') || localStorage.getItem('kasa_theme');
    if (s === 'dark') t = 'dark';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
