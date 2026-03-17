(function () {
  "use strict";

  // ---- Loading screen ----
  var loaderMessages = [
    "Připravuji stránku…",
    "Načítám…",
    "Skoro hotovo…",
  ];
  var loaderEl = document.getElementById("page-loader");
  var loaderMsgEl = document.getElementById("loader-msg");
  var loaderBarEl = document.getElementById("loader-bar-fill");
  var loaderStart = Date.now();
  var loaderMinMs = 1600;
  var loaderMsgIdx = 0;
  var loaderMsgInterval = setInterval(function () {
    loaderMsgIdx = (loaderMsgIdx + 1) % loaderMessages.length;
    if (loaderMsgEl) {
      loaderMsgEl.style.opacity = "0";
      setTimeout(function () {
        loaderMsgEl.textContent = loaderMessages[loaderMsgIdx];
        loaderMsgEl.style.opacity = "1";
      }, 130);
    }
    if (loaderBarEl) {
      var pct = Math.min(95, Math.round((loaderMsgIdx / (loaderMessages.length - 1)) * 90) + 10);
      loaderBarEl.style.width = pct + "%";
    }
  }, 380);

  function hideLoader() {
    clearInterval(loaderMsgInterval);
    if (loaderBarEl) loaderBarEl.style.width = "100%";
    setTimeout(function () {
      if (loaderEl) {
        loaderEl.classList.add("loader-out");
        setTimeout(function () { if (loaderEl) loaderEl.remove(); }, 460);
      }
    }, 200);
  }

  window.addEventListener("load", function () {
    var elapsed = Date.now() - loaderStart;
    var wait = Math.max(0, loaderMinMs - elapsed);
    setTimeout(hideLoader, wait);
  });

  var GITHUB_RELEASE = "https://api.github.com/repos/alexpapillier-lab/jobi/releases/latest";

  // ---- Mockup scroll parallax + rotation ----
  var mockupWin = document.querySelector(".mockup-window");
  var heroEl = document.querySelector(".hero");
  if (mockupWin && heroEl && window.innerWidth > 920) {
    mockupWin.style.willChange = "transform";
    function updateMockup() {
      var heroH = heroEl.offsetHeight;
      var scrollY = window.scrollY;
      var p = Math.min(1, scrollY / (heroH * 0.75));
      var ease = 1 - Math.pow(1 - p, 2); // ease-out
      var ry = -5 + ease * 5;       // -5° → 0°
      var rx = 1.5 - ease * 1.5;    // 1.5° → 0°
      var sc = 0.97 + ease * 0.03;  // 0.97 → 1.0
      var ty = -scrollY * 0.06;     // parallax up
      mockupWin.style.transform =
        "perspective(1200px) translateY(" + ty + "px) rotateY(" + ry + "deg) rotateX(" + rx + "deg) scale(" + sc + ")";
    }
    window.addEventListener("scroll", updateMockup, { passive: true });
    updateMockup();
  }

  // ---- Scroll reveal ----
  var reveals = document.querySelectorAll(".reveal, .feature-card");
  function reveal() {
    reveals.forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      if (top < window.innerHeight - 80) el.classList.add("visible");
    });
  }
  window.addEventListener("scroll", reveal);
  window.addEventListener("load", reveal);
  reveal();

  // ---- Stáhnout Jobi nebo JobiDocs DMG z GitHub ----
  var downloadLoading = document.getElementById("download-loading");

  function triggerDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function fetchReleaseAndDownload(which, btn) {
    if (!btn) return;
    btn.disabled = true;
    if (downloadLoading) downloadLoading.hidden = false;
    fetch(GITHUB_RELEASE)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var assets = (data.assets || []).filter(function (a) {
          var n = (a.name || "").toLowerCase();
          return n.endsWith(".dmg");
        });
        var jobiDmg = assets.find(function (a) {
          var n = (a.name || "").toLowerCase();
          return n.startsWith("jobi") && n.endsWith(".dmg") && n.indexOf("jobidocs") === -1;
        });
        var jobidocsDmg = assets.find(function (a) {
          var n = (a.name || "").toLowerCase();
          return n.indexOf("jobidocs") !== -1 && n.endsWith(".dmg");
        });
        var dmg = which === "jobi" ? jobiDmg : jobidocsDmg;
        if (dmg && dmg.browser_download_url) {
          triggerDownload(dmg.browser_download_url, dmg.name);
        } else {
          window.open("https://github.com/alexpapillier-lab/jobi/releases/latest", "_blank");
        }
      })
      .catch(function () {
        window.open("https://github.com/alexpapillier-lab/jobi/releases/latest", "_blank");
      })
      .finally(function () {
        btn.disabled = false;
        if (downloadLoading) downloadLoading.hidden = true;
      });
  }

  var jobiBtn = document.getElementById("download-jobi-btn");
  var jobidocsBtn = document.getElementById("download-jobidocs-btn");
  if (jobiBtn) {
    jobiBtn.addEventListener("click", function () { fetchReleaseAndDownload("jobi", jobiBtn); });
  }
  if (jobidocsBtn) {
    jobidocsBtn.addEventListener("click", function () { fetchReleaseAndDownload("jobidocs", jobidocsBtn); });
  }
})();
