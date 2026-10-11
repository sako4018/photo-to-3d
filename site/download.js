// Turns every download button on. First choice: the installer built next to this page
// (downloads/latest.json, see scripts/build-release.sh). Second choice: the latest GitHub Release.
(function () {
  var buttons = document.querySelectorAll("[data-download]");
  var INSTALLERS = {
    mac: { href: "downloads/Photo-to-3D-Installer-arm64.dmg", label: "Download for Mac" },
    win: { href: "downloads/Photo-to-3D-Installer-win-x64.zip", label: "Download for Windows" }
  };
  // Mac is the default; Windows only when the browser says so.
  var mine = /Windows/i.test(navigator.userAgent) ? "win" : "mac";
  var other = mine === "win" ? "mac" : "win";

  function enable(href, label, name) {
    buttons.forEach(function (button) {
      button.href = href;
      button.classList.add("ready");
      var sub = button.querySelector(".btn-sub");
      if (sub) { sub.textContent = label; }
      var text = button.querySelector(".btn-label");
      if (text && name) { text.textContent = name; }
    });
  }

  function fromGithub() {
    return fetch("https://api.github.com/repos/sako4018/photo-to-3d/releases/latest")
      .then(function (response) {
        if (!response.ok) { throw new Error("no release"); }
        return response.json();
      })
      .then(function (release) {
        var dmg = null;
        for (var i = 0; i < release.assets.length; i++) {
          if (/\.dmg$/i.test(release.assets[i].name)) { dmg = release.assets[i]; break; }
        }
        if (!dmg) { throw new Error("no dmg"); }
        enable(dmg.browser_download_url, release.tag_name);
      });
  }

  fetch("downloads/latest.json")
    .then(function (response) {
      if (!response.ok) { throw new Error("no local build"); }
      return response.json();
    })
    .then(function (manifest) {
      var files = manifest.files || {};
      if (!files[mine]) { throw new Error("no build for this system"); }
      enable(INSTALLERS[mine].href, "v" + manifest.version + " · installer", INSTALLERS[mine].label);
      var note = document.getElementById("other-systems");
      if (note && files[other]) {
        note.innerHTML = 'Other system: <a href="' + INSTALLERS[other].href + '">' + INSTALLERS[other].label.replace("Download for ", "") + '</a>';
      }
    })
    .catch(function () {
      return fromGithub();
    })
    .catch(function () {
      // Nothing to download yet: buttons keep the "soon" label and link to the releases page.
    });
})();
