// Turns every download button on. First choice: the installers built next to this page
// (downloads/latest.json, see scripts/build-release.sh). Second choice: the latest GitHub Release.
// data-download="mac" or "win" is a button for that system; an empty data-download follows the visitor's system.
(function () {
  var buttons = document.querySelectorAll("[data-download]");
  var INSTALLERS = {
    mac: { href: "downloads/Photo-to-3D-Installer-arm64.dmg", label: "Download for Mac", asset: /\.dmg$/i },
    win: { href: "downloads/Photo-to-3D-Setup-win-x64.exe", label: "Download for Windows", asset: /\.exe$/i }
  };
  // Mac is the default; Windows only when the browser says so.
  var mine = /Windows/i.test(navigator.userAgent) ? "win" : "mac";

  function platformOf(button) {
    return button.getAttribute("data-download") || mine;
  }

  // links: { mac: href, win: href }, only for the systems that have a file
  function enable(links, sub) {
    buttons.forEach(function (button) {
      var platform = platformOf(button);
      if (!links[platform]) { return; }
      button.href = links[platform];
      button.classList.add("ready");
      var subText = button.querySelector(".btn-sub");
      if (subText) { subText.textContent = sub; }
      var text = button.querySelector(".btn-label");
      if (text) { text.textContent = INSTALLERS[platform].label; }
    });
  }

  function fromGithub() {
    return fetch("https://api.github.com/repos/sako4018/photo-to-3d/releases/latest")
      .then(function (response) {
        if (!response.ok) { throw new Error("no release"); }
        return response.json();
      })
      .then(function (release) {
        var links = {};
        release.assets.forEach(function (asset) {
          for (var platform in INSTALLERS) {
            if (!links[platform] && INSTALLERS[platform].asset.test(asset.name)) {
              links[platform] = asset.browser_download_url;
            }
          }
        });
        if (!links.mac && !links.win) { throw new Error("no installer"); }
        enable(links, release.tag_name);
      });
  }

  fetch("downloads/latest.json")
    .then(function (response) {
      if (!response.ok) { throw new Error("no local build"); }
      return response.json();
    })
    .then(function (manifest) {
      var files = manifest.files || {};
      var links = {};
      for (var platform in INSTALLERS) {
        if (files[platform]) { links[platform] = INSTALLERS[platform].href; }
      }
      if (!links.mac && !links.win) { throw new Error("no build"); }
      enable(links, "v" + manifest.version + " · installer");
    })
    .catch(function () {
      return fromGithub();
    })
    .catch(function () {
      // Nothing to download yet: buttons keep the "soon" label and link to the releases page.
    });
})();
