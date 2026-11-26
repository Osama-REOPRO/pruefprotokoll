// Etagenplan: ein Bild pro Etage, frei verschiebbar, zoombar und drehbar.
// Das Bild liegt in einer "Welt" (.pv-world) in Bildkoordinaten (Pixel des Originals).
// Später kommen Türen als Markierungen in dieselbe Welt (gate.pos = { etageId, x, y } in Bildpixeln),
// dann drehen und zoomen sie automatisch mit.
//
// Ansicht: Bildschirmpunkt = (x, y) + Drehung(r) · s · Bildpunkt

const DEG = Math.PI / 180;
const rot = (vx, vy, a) => [vx * Math.cos(a) - vy * Math.sin(a), vx * Math.sin(a) + vy * Math.cos(a)];

export function mountPlan(stage, img, { w, h, rot: r0 = 0, onRot, onChange, onTap, tapMode } = {}) {
  const world = stage.querySelector('.pv-world');
  let v = { x: 0, y: 0, s: 1, r: r0 }, fitS = 1, raf = 0;
  const box = () => stage.getBoundingClientRect();
  const apply = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      world.style.transform = `translate(${v.x}px, ${v.y}px) rotate(${v.r}deg) scale(${v.s})`;
      onChange?.(v, fitS);
    });
  };
  const clampS = (s) => Math.min(Math.max(s, fitS * 0.4), Math.max(fitS * 40, 6));
  // Zoomen um einen Bildschirmpunkt (relativ zur Bühne)
  const zoomAt = (k, cx, cy) => {
    const ns = clampS(v.s * k); k = ns / v.s;
    v.x = cx + (v.x - cx) * k; v.y = cy + (v.y - cy) * k; v.s = ns; apply();
  };
  const rotateAt = (dDeg, cx, cy) => {
    const [dx, dy] = rot(v.x - cx, v.y - cy, dDeg * DEG);
    v.x = cx + dx; v.y = cy + dy; v.r = ((v.r + dDeg) % 360 + 540) % 360 - 180;
    apply(); onRot?.(v.r);
  };
  const pan = (dx, dy) => { v.x += dx; v.y += dy; apply(); };
  const center = () => { const b = box(); return [b.width / 2, b.height / 2]; };
  // Ganzes Bild (gedreht) in die Bühne einpassen
  const fit = (keepRot = true) => {
    const b = box(), a = (keepRot ? v.r : 0) * DEG;
    const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    fitS = Math.min((b.width - 24) / bw, (b.height - 24) / bh);
    v.s = fitS; v.r = keepRot ? v.r : 0;
    const [qx, qy] = rot(w / 2 * v.s, h / 2 * v.s, v.r * DEG);
    v.x = b.width / 2 - qx; v.y = b.height / 2 - qy; apply();
  };
  // Drehung auf einen festen Winkel setzen, um die Mitte
  const setRot = (deg) => { const [cx, cy] = center(); rotateAt(deg - v.r, cx, cy); };

  // ----- Zeiger: Maus, Stift, Finger -----
  const pts = new Map();
  let prev = null, lastTap = 0, rDrag = null, tap0 = null;
  const local = (e) => { const b = box(); return [e.clientX - b.left, e.clientY - b.top]; };
  const snapshot = () => {
    const p = [...pts.values()];
    if (p.length === 1) return { m: p[0] };
    const [a, b] = p;
    return { m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: Math.hypot(b[0] - a[0], b[1] - a[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  let tapTimer = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pv-ui, .pv-pin')) return;
    stage.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse' && (e.button === 2 || e.altKey)) {
      // Rechte Maustaste (oder Alt) ziehen: um die Mitte drehen
      const [cx, cy] = center(), [px, py] = local(e);
      rDrag = { id: e.pointerId, a: Math.atan2(py - cy, px - cx) };
      stage.classList.add('rotating'); return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, local(e));
    tap0 = pts.size === 1 ? { p: local(e), t: Date.now() } : null;
    prev = pts.size <= 2 ? snapshot() : prev;
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (rDrag && rDrag.id === e.pointerId) {
      const [cx, cy] = center(), [px, py] = local(e), a = Math.atan2(py - cy, px - cx);
      rotateAt((a - rDrag.a) / DEG, cx, cy); rDrag.a = a; return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (pts.size > 2) return;
    const cur = snapshot();
    if (prev && cur.d && prev.d) {
      pan(cur.m[0] - prev.m[0], cur.m[1] - prev.m[1]);
      zoomAt(cur.d / prev.d, cur.m[0], cur.m[1]);
      rotateAt((cur.ang - prev.ang) / DEG, cur.m[0], cur.m[1]);
    } else if (prev && !cur.d && !prev.d) pan(cur.m[0] - prev.m[0], cur.m[1] - prev.m[1]);
    prev = cur;
  });
  const up = (e) => {
    if (rDrag && rDrag.id === e.pointerId) { rDrag = null; stage.classList.remove('rotating'); return; }
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    prev = pts.size ? snapshot() : null;
    if (!pts.size) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', (e) => {
    // Doppeltippen (Finger): hineinzoomen
    const [ux, uy] = local(e);
    const isTap = pts.size === 1 && tap0 && Date.now() - tap0.t < 450 && Math.hypot(ux - tap0.p[0], uy - tap0.p[1]) < (e.pointerType === 'mouse' ? 5 : 12);
    up(e);
    if (!isTap) return;
    if (e.pointerType === 'mouse') { clearTimeout(tapTimer); tapTimer = setTimeout(() => onTap?.(ux, uy, e.pointerType), 230); return; }
    // Finger: im Platzier-Modus zählt jeder Tipp, sonst zoomt Doppeltippen
    if (tapMode?.()) return onTap?.(ux, uy, e.pointerType);
    const now = Date.now();
    if (now - lastTap < 280) { zoomAt(2, ux, uy); lastTap = 0; } else { lastTap = now; onTap?.(ux, uy, e.pointerType); }
  });
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('dblclick', (e) => { clearTimeout(tapTimer); if (e.target.closest('.pv-ui, .pv-pin')) return; const [px, py] = local(e); zoomAt(e.shiftKey ? 0.5 : 2, px, py); });
  // Mausrad / Touchpad: zoomen; mit Umschalt drehen
  stage.addEventListener('wheel', (e) => {
    if (e.target.closest('.pv-ui')) return;
    e.preventDefault();
    const [px, py] = local(e), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.shiftKey) return rotateAt((d || e.deltaX) * 0.15, px, py);
    zoomAt(Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), px, py);
  }, { passive: false });
  // Safari (Mac-Touchpad): Zwei-Finger-Geste zoomt und dreht
  let gs = null;
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = { s: 1, r: 0 }; });
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault(); if (!gs || pts.size) return;
    const [px, py] = local(e);
    zoomAt(e.scale / gs.s, px, py); rotateAt(e.rotation - gs.r, px, py); gs = { s: e.scale, r: e.rotation };
  });
  stage.addEventListener('gestureend', (e) => { e.preventDefault(); gs = null; });

  // Größe der Bühne ändert sich (Drehen des Handys, Fenster): Mitte beibehalten
  let last = null;
  const ro = new ResizeObserver(() => {
    const b = box();
    if (last && b.width && last.width) pan((b.width - last.width) / 2, (b.height - last.height) / 2);
    last = { width: b.width, height: b.height };
  });
  img.decode?.().catch(() => {}).finally(() => { fit(); last = { width: box().width, height: box().height }; ro.observe(stage); });

  return {
    zoomIn: () => zoomAt(1.4, ...center()), zoomOut: () => zoomAt(1 / 1.4, ...center()),
    rotate: (d) => { const [cx, cy] = center(); rotateAt(d, cx, cy); }, setRot, fit: () => fit(true),
    pan, get view() { return { ...v }; }, get fitScale() { return fitS; },
    // Bildpunkt <-> Punkt auf der Bühne (für Markierungen, die aufrecht und gleich groß bleiben)
    toScreen: (px, py) => { const [dx, dy] = rot(px * v.s, py * v.s, v.r * DEG); return [v.x + dx, v.y + dy]; },
    toImage: (sx, sy) => { const [dx, dy] = rot(sx - v.x, sy - v.y, -v.r * DEG); return [dx / v.s, dy / v.s]; },
    // Einen Bildpunkt in die Mitte holen (z. B. eine Tür zeigen)
    focus: (px, py, k = 3) => { const b = box(); v.s = clampS(Math.max(v.s, fitS * k)); const [dx, dy] = rot(px * v.s, py * v.s, v.r * DEG); v.x = b.width / 2 - dx; v.y = b.height / 2 - dy; apply(); },
    refresh: apply,
    destroy: () => ro.disconnect(),
  };
}

// Bild für den Plan vorbereiten: sehr große Bilder verkleinern (Handys schaffen keine riesigen Texturen)
export async function preparePlanImage(file, max = 4096) {
  const bmp = await createImageBitmap(file);
  let { width: w, height: h } = bmp;
  if (Math.max(w, h) <= max) { bmp.close?.(); return { blob: file, w, h }; }
  const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise(r => c.toBlob(r, type, 0.9));
  return { blob, w, h };
}
