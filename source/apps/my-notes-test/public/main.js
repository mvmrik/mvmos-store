// Written by mvmOS App Builder from a platform template. It only opens the app in its sandbox.
(function () {
  var ID = "my-notes-test";
  var NAMES = {"bg": "Notes Test", "de": "Notes Test", "en": "Notes Test", "es": "Notes Test", "fr": "Notes Test", "ja": "Notes Test", "pt-BR": "Notes Test", "ru": "Notes Test", "zh-CN": "Notes Test"};
  function appName() { var l = (window.mvmOS && mvmOS.lang) || 'en'; return NAMES[l] || NAMES.en || "Notes Test"; }
  mvmOS.registerApp({
    id: ID,
    name: "Notes Test",
    icon: "✅",
    category: "Productivity",
    requires_apphub: true,
    launch: function () {
      if (!window.BuilderRuntime) { mvmOS.notify(appName(), 'This app needs a newer mvmOS.'); return; }
      window.BuilderRuntime.openInstalled({ id: ID, name: appName(), icon: "✅" });
    },
  });
})();
