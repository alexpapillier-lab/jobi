/**
 * Jobi Capture – mobilní stránka pro focení diagnostiky z telefonu.
 * URL: ?ticket=XXX&token=YYY
 * Konfigurace: uprav CAPTURE_CONFIG níže (Supabase URL).
 */
(function () {
  'use strict';

  const CAPTURE_CONFIG = window.CAPTURE_CONFIG || { supabaseUrl: '' };

  const params = new URLSearchParams(window.location.search);
  const ticketId = params.get('ticket') || '';
  const token = params.get('token') || '';
  const scope = params.get('scope') || 'after'; // 'before' = fotky při příjmu

  const $ = (id) => document.getElementById(id);
  const loading = $('loading');
  const screenCamera = $('screen-camera');
  const screenSuccess = $('screen-success');
  const screenError = $('screen-error');
  const cameraWrap = $('cameraWrap');
  const video = $('video');
  const canvas = $('canvas');
  const shutterBtn = $('shutterBtn');
  const previewOverlay = $('previewOverlay');
  const retakeBtn = $('retakeBtn');
  const uploadBtn = $('uploadBtn');
  const anotherBtn = $('anotherBtn');
  const retryBtn = $('retryBtn');
  const galleryBtn = $('galleryBtn');
  const fileInput = $('fileInput');
  const zoomBar = $('zoomBar');
  const errorMessage = $('errorMessage');

  let stream = null;
  let videoTrack = null;
  let zoomCap = null; // { min, max, step }
  let currentZoom = 1;
  let capturedBlob = null;
  let supabaseUrl = CAPTURE_CONFIG.supabaseUrl || params.get('api') || '';

  function showScreen(id) {
    loading.classList.add('hidden');
    screenCamera.classList.remove('active');
    screenSuccess.classList.remove('active');
    screenError.classList.remove('active');
    const el = $(id);
    if (el) el.classList.add('active');
  }

  function showError(msg) {
    errorMessage.textContent = msg || 'Došlo k neočekávané chybě.';
    showScreen('screen-error');
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      videoTrack = null;
    }
  }

  function setCameraAspectRatio(/* w, h */) {
    // Full-screen režim – kamera vyplní celou obrazovku, neomezujeme proporce
  }

  function buildZoomButtons() {
    if (!zoomBar || !zoomCap || zoomCap.min >= zoomCap.max) return;
    zoomBar.innerHTML = '';
    zoomBar.classList.remove('hidden');
    const inRange = (z) => z >= zoomCap.min - 0.01 && z <= zoomCap.max + 0.01;
    // Jen 0.5×, 1×, 2× – běžné optické zoom na telefonech (ne 3×, 5×)
    const candidates = [0.5, 1, 2];
    const maxShow = 2; // nikdy víc než 2×
    const presets = candidates.filter((z) => inRange(z) && z <= maxShow);
    if (presets.length < 2) {
      presets.length = 0;
      if (inRange(1)) presets.push(1);
      if (inRange(2) && 2 <= maxShow) presets.push(2);
      else if (zoomCap.max > 1 && zoomCap.max <= maxShow) presets.push(zoomCap.max);
      else if (zoomCap.min < 1 && zoomCap.min >= 0.5) presets.unshift(zoomCap.min);
    }
    if (presets.length < 2) { zoomBar.classList.add('hidden'); return; }
    presets.sort((a, b) => a - b);
    presets.forEach((z) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'zoom-btn' + (Math.abs(currentZoom - z) < 0.01 ? ' active' : '');
      btn.textContent = z + '×';
      btn.dataset.zoom = String(z);
      btn.addEventListener('click', () => setZoom(z));
      zoomBar.appendChild(btn);
    });
  }

  function drawWatermark(ctx, w, h) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = dateStr + ' ' + timeStr + ' · jobi';
    const fontSize = Math.max(12, Math.round(Math.min(w, h) * 0.03));
    ctx.font = fontSize + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const pad = Math.round(fontSize * 0.8);
    const x = w - pad;
    const y = h - pad;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(label, x, y);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  function setZoom(value) {
    if (!videoTrack || !zoomCap || value < zoomCap.min || value > zoomCap.max) return;
    videoTrack.applyConstraints({ advanced: [{ zoom: value }] }).then(() => {
      currentZoom = value;
      if (video.videoWidth) setCameraAspectRatio(video.videoWidth, video.videoHeight);
      zoomBar.querySelectorAll('.zoom-btn').forEach((btn) => {
        const z = parseFloat(btn.dataset.zoom || btn.textContent);
        btn.classList.toggle('active', Math.abs(currentZoom - z) < 0.01);
      });
    }).catch(() => {});
  }

  async function initCamera() {
    const hasCamera = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    cameraWrap.style.aspectRatio = ''; // reset
    zoomCap = null;
    currentZoom = 1;
    if (zoomBar) { zoomBar.innerHTML = ''; zoomBar.classList.add('hidden'); }
    if (hasCamera) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        videoTrack = stream.getVideoTracks()[0] || null;
        if (videoTrack) {
          const cap = videoTrack.getCapabilities();
          if (cap.zoom && typeof cap.zoom === 'object' && cap.zoom.min != null && cap.zoom.max != null && cap.zoom.min < cap.zoom.max) {
            zoomCap = { min: cap.zoom.min, max: cap.zoom.max, step: cap.zoom.step || 0.1 };
            currentZoom = Math.max(zoomCap.min, Math.min(zoomCap.max, 1));
          }
        }
        video.srcObject = stream;
        await video.play();
        video.addEventListener('loadedmetadata', function onMeta() {
          video.removeEventListener('loadedmetadata', onMeta);
          setCameraAspectRatio(video.videoWidth, video.videoHeight);
          buildZoomButtons();
        }, { once: true });
        if (video.videoWidth) {
          setCameraAspectRatio(video.videoWidth, video.videoHeight);
          buildZoomButtons();
        }
      } catch (e) {
        shutterBtn.classList.add('hidden');
      }
    } else {
      shutterBtn.classList.add('hidden');
    }
    showScreen('screen-camera');
  }

  function capture() {
    if (!stream || !video.videoWidth) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    drawWatermark(ctx, w, h);
    capturedBlob = null;
    canvas.toBlob(
      (blob) => {
        capturedBlob = blob;
        cameraWrap.classList.add('preview');
        shutterBtn.classList.add('hidden');
        if (galleryBtn) galleryBtn.classList.add('hidden');
        if (zoomBar) zoomBar.classList.add('hidden');
        if (previewOverlay) previewOverlay.classList.remove('hidden');
      },
      'image/jpeg',
      0.9
    );
  }

  function retake() {
    capturedBlob = null;
    cameraWrap.classList.remove('preview');
    if (video.videoWidth) setCameraAspectRatio(video.videoWidth, video.videoHeight);
    else cameraWrap.style.aspectRatio = '';
    shutterBtn.classList.remove('hidden');
    if (previewOverlay) previewOverlay.classList.add('hidden');
    if (galleryBtn) galleryBtn.classList.remove('hidden');
    if (zoomBar && zoomCap) zoomBar.classList.remove('hidden');
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Odeslat';
  }

  function setBlobFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setCameraAspectRatio(img.width, img.height);
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        drawWatermark(ctx, img.width, img.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              capturedBlob = blob;
              cameraWrap.classList.add('preview');
              shutterBtn.classList.add('hidden');
              if (galleryBtn) galleryBtn.classList.add('hidden');
              if (zoomBar) zoomBar.classList.add('hidden');
              if (previewOverlay) previewOverlay.classList.remove('hidden');
            } else {
              showError('Nepodařilo se načíst obrázek.');
            }
          },
          'image/jpeg',
          0.9
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function upload() {
    if (!capturedBlob || !ticketId || !token) {
      showError('Chybí údaje ze stránky. Naskenujte znovu QR kód v aplikaci Jobi.');
      return;
    }
    if (!supabaseUrl) {
      showError('Stránka není nakonfigurovaná. Kontaktujte správce.');
      return;
    }
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Odesílám…';
    const reader = new FileReader();
    reader.readAsDataURL(capturedBlob);
    reader.onloadend = async () => {
      const base64 = (reader.result || '').split(',')[1];
      if (!base64) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Odeslat';
        showError('Nepodařilo se připravit obrázek.');
        return;
      }
      try {
        const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/capture-upload`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, token, image: base64, scope: scope }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || data.message || `Chyba ${res.status}`);
        }
        stopStream();
        showScreen('screen-success');
      } catch (e) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Odeslat';
        showError(e.message || 'Upload se nezdařil. Zkontrolujte připojení.');
      }
    };
  }

  function reset() {
    retake();
    initCamera();
  }

  shutterBtn.addEventListener('click', capture);
  retakeBtn.addEventListener('click', retake);
  uploadBtn.addEventListener('click', upload);
  anotherBtn.addEventListener('click', reset);
  if (galleryBtn && fileInput) {
    galleryBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      showError('Vyberte obrázek.');
      return;
    }
    setBlobFromFile(file);
    });
  }
  retryBtn.addEventListener('click', () => {
    showScreen('loading');
    loading.classList.remove('hidden');
    initCamera();
  });

  if (!ticketId || !token) {
    showError('Neplatný odkaz. Naskenujte QR kód z detailu zakázky v aplikaci Jobi.');
  } else {
    initCamera();
  }

  window.addEventListener('beforeunload', stopStream);
  window.addEventListener('pagehide', stopStream);
})();
