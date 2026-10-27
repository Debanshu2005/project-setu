// Project Setu - Interactive Scientific Charts & Canvas Plotting Engine
// Pure Canvas renderers with dark technical aesthetics, interactive crosshairs,
// tooltips, HiDPI Retina support, theoretical curve overlays, and eCDFs.

/**
 * Utility to setup HiDPI canvas backing store
 */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.clientWidth || 600;
  const height = rect.height || 260;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.resetTransform?.();
  ctx.scale(dpr, dpr);
  return { ctx, width, height, dpr };
}

/**
 * 1. Scientific Line Chart (Time Series & Relationship Curves)
 */
export class ScientificLineChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.options = {
      title: options.title || '',
      xLabel: options.xLabel || 'Time (s)',
      yLabel: options.yLabel || 'Value',
      yUnit: options.yUnit || '',
      yMin: options.yMin !== undefined ? options.yMin : null,
      yMax: options.yMax !== undefined ? options.yMax : null,
      showGrid: options.showGrid !== false,
      thresholds: options.thresholds || [], // [{ y, label, color, dash }]
      shadedIntervals: options.shadedIntervals || [], // [{ xStart, xEnd, label, color }]
      ...options
    };
    this.series = []; // [{ name, data: [{ x, y }], color, lineWidth, dashed, fillArea }]
    this.hoverPos = null;

    this.initEvents();
  }

  setSeries(series) {
    this.series = series;
    this.render();
  }

  setShadedIntervals(intervals) {
    this.options.shadedIntervals = intervals;
    this.render();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.render();
    });
  }

  render() {
    const { ctx, width, height } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 65;
    const padRight = 25;
    const padTop = 32;
    const padBottom = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (plotW <= 10 || plotH <= 10) return;

    // Determine X and Y bounds
    let allX = [];
    let allY = [];
    for (const s of this.series) {
      for (const p of s.data || []) {
        if (p.x !== null && !isNaN(p.x)) allX.push(p.x);
        if (p.y !== null && !isNaN(p.y)) allY.push(p.y);
      }
    }

    if (allX.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.options.emptyMessage || 'NO MEASURED OBSERVATIONS', width / 2, height / 2);
      return;
    }

    let minX = Math.min(...allX);
    let maxX = Math.max(...allX);
    if (minX === maxX) { minX -= 1; maxX += 1; }

    let minY = this.options.yMin !== null ? this.options.yMin : Math.min(...allY);
    let maxY = this.options.yMax !== null ? this.options.yMax : Math.max(...allY);
    if (minY === maxY) { minY = Math.max(0, minY - 10); maxY += 10; }

    const scaleX = x => padLeft + ((x - minX) / (maxX - minX)) * plotW;
    const scaleY = y => padTop + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // 1. Shaded Outage / Context Intervals
    for (const interval of this.options.shadedIntervals || []) {
      const x0 = Math.max(padLeft, scaleX(interval.xStart));
      const x1 = Math.min(padLeft + plotW, scaleX(interval.xEnd));
      if (x1 > x0) {
        ctx.fillStyle = interval.color || 'rgba(239, 68, 68, 0.15)';
        ctx.fillRect(x0, padTop, x1 - x0, plotH);

        if (interval.label) {
          ctx.save();
          ctx.fillStyle = interval.textColor || '#f87171';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(interval.label, (x0 + x1) / 2, padTop + 14);
          ctx.restore();
        }
      }
    }

    // 2. Grid lines & Axis ticks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    // Horizontal Y Grid
    const yTicks = 5;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= yTicks; i++) {
      const yVal = minY + (i / yTicks) * (maxY - minY);
      const yPos = scaleY(yVal);
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(padLeft + plotW, yPos);
      ctx.stroke();

      const valStr = yVal >= 1000 ? `${(yVal / 1000).toFixed(1)}k` : yVal.toFixed(yVal % 1 === 0 ? 0 : 1);
      ctx.fillText(`${valStr}${this.options.yUnit ? ' ' + this.options.yUnit : ''}`, padLeft - 8, yPos);
    }

    // Vertical X Grid
    const xTicks = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let i = 0; i <= xTicks; i++) {
      const xVal = minX + (i / xTicks) * (maxX - minX);
      const xPos = scaleX(xVal);
      ctx.beginPath();
      ctx.moveTo(xPos, padTop);
      ctx.lineTo(xPos, padTop + plotH);
      ctx.stroke();

      ctx.fillText(`${xVal.toFixed(xVal % 1 === 0 ? 0 : 1)}s`, xPos, padTop + plotH + 6);
    }

    // 3. Threshold Lines
    for (const th of this.options.thresholds) {
      if (th.y >= minY && th.y <= maxY) {
        const yPos = scaleY(th.y);
        ctx.save();
        ctx.strokeStyle = th.color || '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(th.dash || [4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yPos);
        ctx.lineTo(padLeft + plotW, yPos);
        ctx.stroke();

        ctx.fillStyle = th.color || '#ef4444';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(th.label || '', padLeft + 6, yPos - 5);
        ctx.restore();
      }
    }

    // 4. Series curves
    for (const s of this.series) {
      const pts = (s.data || []).filter(p => p.x !== null && p.y !== null && !isNaN(p.x) && !isNaN(p.y));
      if (pts.length === 0) continue;

      ctx.save();
      ctx.strokeStyle = s.color || '#38bdf8';
      ctx.lineWidth = s.lineWidth || 2;
      if (s.dashed) ctx.setLineDash([4, 4]);

      // Fill area if requested
      if (s.fillArea) {
        ctx.beginPath();
        ctx.moveTo(scaleX(pts[0].x), scaleY(minY));
        for (const p of pts) {
          ctx.lineTo(scaleX(p.x), scaleY(p.y));
        }
        ctx.lineTo(scaleX(pts[pts.length - 1].x), scaleY(minY));
        ctx.closePath();
        ctx.fillStyle = s.fillColor || 'rgba(56, 189, 248, 0.12)';
        ctx.fill();
      }

      // Draw line
      ctx.beginPath();
      let first = true;
      for (const p of pts) {
        const px = scaleX(p.x);
        const py = scaleY(p.y);
        if (first) {
          ctx.moveTo(px, py);
          first = false;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();

      // Draw point markers if sparse
      if (pts.length <= 40 && !s.noPoints) {
        ctx.fillStyle = s.color || '#38bdf8';
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(scaleX(p.x), scaleY(p.y), 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    // 5. Border box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // 6. Title and Axis Labels
    if (this.options.title) {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '700 12px "Outfit", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(this.options.title, padLeft, 8);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.options.xLabel, padLeft + plotW / 2, height - 8);

    ctx.save();
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.options.yLabel, 0, 0);
    ctx.restore();

    // 7. Legend
    let legendX = width - padRight;
    ctx.textAlign = 'right';
    ctx.font = '10px "JetBrains Mono", monospace';
    for (let i = this.series.length - 1; i >= 0; i--) {
      const s = this.series[i];
      ctx.fillStyle = s.color || '#38bdf8';
      ctx.fillText(s.name, legendX, 16);
      const textW = ctx.measureText(s.name).width;
      ctx.fillRect(legendX - textW - 14, 10, 8, 8);
      legendX -= (textW + 28);
    }

    // 8. Interactive Hover Crosshair & Tooltip
    if (this.hoverPos &&
        this.hoverPos.x >= padLeft && this.hoverPos.x <= padLeft + plotW &&
        this.hoverPos.y >= padTop && this.hoverPos.y <= padTop + plotH) {
      const hoverXVal = minX + ((this.hoverPos.x - padLeft) / plotW) * (maxX - minX);

      // Draw vertical crosshair
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(this.hoverPos.x, padTop);
      ctx.lineTo(this.hoverPos.x, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tooltip entries
      const tooltipLines = [`t = ${hoverXVal.toFixed(2)}s`];
      for (const s of this.series) {
        // Find nearest point
        let nearest = null;
        let minDist = Infinity;
        for (const p of s.data || []) {
          if (p.x !== null && p.y !== null) {
            const d = Math.abs(p.x - hoverXVal);
            if (d < minDist) {
              minDist = d;
              nearest = p;
            }
          }
        }
        if (nearest) {
          tooltipLines.push(`${s.name}: ${nearest.y.toFixed(1)}${this.options.yUnit ? ' ' + this.options.yUnit : ''}`);
        }
      }

      // Draw tooltip box
      ctx.font = '10px "JetBrains Mono", monospace';
      const maxW = Math.max(...tooltipLines.map(l => ctx.measureText(l).width));
      const boxW = maxW + 16;
      const boxH = tooltipLines.length * 15 + 10;
      let boxX = this.hoverPos.x + 12;
      let boxY = this.hoverPos.y - 20;

      if (boxX + boxW > width - 10) boxX = this.hoverPos.x - boxW - 12;
      if (boxY + boxH > height - 10) boxY = height - boxH - 10;
      if (boxY < 10) boxY = 10;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let li = 0; li < tooltipLines.length; li++) {
        ctx.fillStyle = li === 0 ? '#38bdf8' : '#e2e8f0';
        ctx.fillText(tooltipLines[li], boxX + 8, boxY + 6 + li * 15);
      }
    }
  }
}

/**
 * 2. Scientific Scatter Plot with Theoretical Curve Overlay
 */
export class ScientificScatterPlot {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.options = {
      title: options.title || '',
      xLabel: options.xLabel || 'Distance (m)',
      yLabel: options.yLabel || 'RSSI (dBm)',
      xUnit: options.xUnit || 'm',
      yUnit: options.yUnit || 'dBm',
      logScaleX: options.logScaleX || false,
      theoryCurve: options.theoryCurve || null, // fn(x) -> y
      theoryLabel: options.theoryLabel || 'Theoretical Model',
      thresholds: options.thresholds || [],
      ...options
    };
    this.points = []; // [{ x, y, label, nodeA, nodeB, success: true }]
    this.hoverPos = null;

    this.initEvents();
  }

  setData(points, theoryCurve = null) {
    this.points = points;
    if (theoryCurve) this.options.theoryCurve = theoryCurve;
    this.render();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.render();
    });
  }

  render() {
    const { ctx, width, height } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 65;
    const padRight = 30;
    const padTop = 32;
    const padBottom = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (plotW <= 10 || plotH <= 10) return;

    const validPts = this.points.filter(p => typeof p.x === 'number' && typeof p.y === 'number' && !isNaN(p.x) && !isNaN(p.y));

    if (validPts.length === 0 && !this.options.theoryCurve) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO PACKET TRANSMISSIONS OBSERVED', width / 2, height / 2);
      return;
    }

    const minX = Math.max(1, this.options.xMin !== undefined ? this.options.xMin : (validPts.length ? Math.min(...validPts.map(p => p.x)) : 10));
    const maxX = this.options.xMax !== undefined ? this.options.xMax : (validPts.length ? Math.max(...validPts.map(p => p.x), 800) : 1000);

    const minY = this.options.yMin !== undefined ? this.options.yMin : (validPts.length ? Math.min(...validPts.map(p => p.y), -140) : -140);
    const maxY = this.options.yMax !== undefined ? this.options.yMax : (validPts.length ? Math.max(...validPts.map(p => p.y), -40) : -40);

    const scaleX = x => {
      if (this.options.logScaleX) {
        const lxMin = Math.log10(Math.max(1, minX));
        const lxMax = Math.log10(Math.max(1, maxX));
        return padLeft + ((Math.log10(Math.max(1, x)) - lxMin) / (lxMax - lxMin)) * plotW;
      }
      return padLeft + ((x - minX) / (maxX - minX)) * plotW;
    };

    const scaleY = y => padTop + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // 1. Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    // Y ticks
    const yTicks = 5;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= yTicks; i++) {
      const yVal = minY + (i / yTicks) * (maxY - minY);
      const yPos = scaleY(yVal);
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(padLeft + plotW, yPos);
      ctx.stroke();
      ctx.fillText(`${yVal.toFixed(0)} ${this.options.yUnit}`, padLeft - 6, yPos);
    }

    // X ticks
    const xTicks = 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const xVal = minX + (i / xTicks) * (maxX - minX);
      const xPos = scaleX(xVal);
      ctx.beginPath();
      ctx.moveTo(xPos, padTop);
      ctx.lineTo(xPos, padTop + plotH);
      ctx.stroke();
      ctx.fillText(`${xVal.toFixed(0)}m`, xPos, padTop + plotH + 6);
    }

    // 2. Threshold Lines (e.g. Sensitivity)
    for (const th of this.options.thresholds) {
      if (th.y >= minY && th.y <= maxY) {
        const yPos = scaleY(th.y);
        ctx.save();
        ctx.strokeStyle = th.color || '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(th.dash || [5, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yPos);
        ctx.lineTo(padLeft + plotW, yPos);
        ctx.stroke();

        ctx.fillStyle = th.color || '#ef4444';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${th.label} (${th.y} ${this.options.yUnit})`, padLeft + 8, yPos - 5);
        ctx.restore();
      }
    }

    // 3. Theoretical Function Curve
    if (typeof this.options.theoryCurve === 'function') {
      ctx.save();
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      const steps = 80;
      for (let s = 0; s <= steps; s++) {
        const xVal = minX + (s / steps) * (maxX - minX);
        const yVal = this.options.theoryCurve(xVal);
        const px = scaleX(xVal);
        const py = scaleY(yVal);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Scatter observations
    for (const pt of validPts) {
      const px = scaleX(pt.x);
      const py = scaleY(pt.y);

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);

      if (pt.success === false) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.strokeStyle = '#ef4444';
      } else {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
        ctx.strokeStyle = '#38bdf8';
      }
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 5. Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // 6. Title and Labels
    if (this.options.title) {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '700 12px "Outfit", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${this.options.title} [n=${validPts.length} observations]`, padLeft, 8);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.options.xLabel, padLeft + plotW / 2, height - 8);

    ctx.save();
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.options.yLabel, 0, 0);
    ctx.restore();

    // 7. Legend
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#06b6d4';
    ctx.fillText(this.options.theoryLabel, width - padRight, 14);

    // 8. Hover inspection
    if (this.hoverPos) {
      // Find nearest point
      let nearest = null;
      let minDist = 18; // 18px capture radius
      for (const pt of validPts) {
        const d = Math.hypot(scaleX(pt.x) - this.hoverPos.x, scaleY(pt.y) - this.hoverPos.y);
        if (d < minDist) {
          minDist = d;
          nearest = pt;
        }
      }

      if (nearest) {
        const nx = scaleX(nearest.x);
        const ny = scaleY(nearest.y);

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(nx, ny, 6, 0, Math.PI * 2);
        ctx.stroke();

        const lines = [
          nearest.label || `Link: Node ${nearest.nodeA} ➔ ${nearest.nodeB}`,
          `Distance: ${nearest.x.toFixed(1)} m`,
          `Measured: ${nearest.y.toFixed(1)} ${this.options.yUnit}`
        ];
        if (nearest.samples) lines.push(`Samples: ${nearest.samples}`);
        if (nearest.linkMargin !== undefined) lines.push(`Link Margin: ${nearest.linkMargin > 0 ? '+' : ''}${nearest.linkMargin.toFixed(1)} dB`);

        ctx.font = '10px "JetBrains Mono", monospace';
        const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
        const boxH = lines.length * 15 + 10;
        let bx = nx + 10;
        let by = ny - 20;
        if (bx + boxW > width - 10) bx = nx - boxW - 10;
        if (by + boxH > height - 10) by = height - boxH - 10;
        if (by < 10) by = 10;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.strokeStyle = '#38bdf8';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeRect(bx, by, boxW, boxH);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let i = 0; i < lines.length; i++) {
          ctx.fillStyle = i === 0 ? '#38bdf8' : '#e2e8f0';
          ctx.fillText(lines[i], bx + 8, by + 6 + i * 15);
        }
      }
    }
  }
}

/**
 * 3. Scientific Empirical Cumulative Distribution Function (eCDF) Plot
 */
export class ScientificCdfPlot {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.options = {
      title: options.title || 'Cumulative Distribution Function (eCDF)',
      xLabel: options.xLabel || 'Latency (ms)',
      xUnit: options.xUnit || 'ms',
      showPercentiles: options.showPercentiles !== false,
      ...options
    };
    this.cdfs = []; // [{ name, ecdfObj, color }]
    this.hoverPos = null;

    this.initEvents();
  }

  setCdfs(cdfs) {
    this.cdfs = cdfs;
    this.render();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.render();
    });
  }

  render() {
    const { ctx, width, height } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 60;
    const padRight = 30;
    const padTop = 32;
    const padBottom = 40;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (plotW <= 10 || plotH <= 10) return;

    let allX = [];
    for (const c of this.cdfs) {
      if (c.ecdfObj && c.ecdfObj.points) {
        allX.push(...c.ecdfObj.points.map(p => p.x));
      }
    }

    if (allX.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO SAMPLES DELIVERED FOR CDF', width / 2, height / 2);
      return;
    }

    let minX = Math.min(...allX);
    let maxX = Math.max(...allX);
    if (minX === maxX) { minX = Math.max(0, minX - 10); maxX += 10; }

    const scaleX = x => padLeft + ((x - minX) / (maxX - minX)) * plotW;
    const scaleY = y => padTop + plotH - (y / 100.0) * plotH;

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    // Y Grid: 0%, 25%, 50%, 75%, 100%
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const pct of [0, 25, 50, 75, 100]) {
      const yPos = scaleY(pct);
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(padLeft + plotW, yPos);
      ctx.stroke();
      ctx.fillText(`${pct}%`, padLeft - 6, yPos);
    }

    // X Grid
    const xTicks = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const xVal = minX + (i / xTicks) * (maxX - minX);
      const xPos = scaleX(xVal);
      ctx.beginPath();
      ctx.moveTo(xPos, padTop);
      ctx.lineTo(xPos, padTop + plotH);
      ctx.stroke();
      ctx.fillText(`${xVal.toFixed(0)}${this.options.xUnit}`, xPos, padTop + plotH + 6);
    }

    // Draw eCDF step curves
    for (const item of this.cdfs) {
      const pts = item.ecdfObj.points || [];
      if (pts.length === 0) continue;

      ctx.save();
      ctx.strokeStyle = item.color || '#10b981';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      // Step function start
      ctx.moveTo(scaleX(minX), scaleY(0));
      let curX = scaleX(pts[0].x);
      let curY = scaleY(0);
      ctx.lineTo(curX, curY);

      for (let i = 0; i < pts.length; i++) {
        const nextX = scaleX(pts[i].x);
        const nextY = scaleY(pts[i].y);
        // Step horizontal then vertical
        ctx.lineTo(nextX, curY);
        ctx.lineTo(nextX, nextY);
        curX = nextX;
        curY = nextY;
      }
      ctx.stroke();
      ctx.restore();

      // Primary series percentile annotations
      if (this.options.showPercentiles && item === this.cdfs[0]) {
        const quantiles = [
          { p: 'p50', val: item.ecdfObj.p50, yPct: 50, color: '#38bdf8' },
          { p: 'p90', val: item.ecdfObj.p90, yPct: 90, color: '#f59e0b' },
          { p: 'p95', val: item.ecdfObj.p95, yPct: 95, color: '#ef4444' }
        ];

        for (const q of quantiles) {
          if (q.val !== null) {
            const qx = scaleX(q.val);
            const qy = scaleY(q.yPct);

            ctx.save();
            ctx.strokeStyle = q.color;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(qx, scaleY(0));
            ctx.lineTo(qx, qy);
            ctx.lineTo(padLeft, qy);
            ctx.stroke();

            ctx.fillStyle = q.color;
            ctx.beginPath();
            ctx.arc(qx, qy, 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`${q.p.toUpperCase()}: ${q.val}${this.options.xUnit}`, qx + 5, qy - 4);
            ctx.restore();
          }
        }
      }
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // Title and Labels
    if (this.options.title) {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '700 12px "Outfit", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(this.options.title, padLeft, 8);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.options.xLabel, padLeft + plotW / 2, height - 8);

    ctx.save();
    ctx.translate(14, padTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Cumulative Percentage (%)', 0, 0);
    ctx.restore();
  }
}

/**
 * 4. Scientific Heatmap (Node-to-Node Link Quality Matrix)
 */
export class ScientificHeatmap {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.options = {
      title: options.title || 'Link-Quality Matrix',
      metricType: options.metricType || 'rssi', // 'rssi'|'snr'|'prr'|'loss_rate'|'link_margin'
      ...options
    };
    this.matrixData = null; // { nodeIds, nodes, matrix }
    this.hoverCell = null;

    this.initEvents();
  }

  setMatrix(matrixData) {
    this.matrixData = matrixData;
    this.render();
  }

  setMetricType(metricType) {
    this.options.metricType = metricType;
    this.render();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', e => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.checkHover(mx, my);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverCell = null;
      this.render();
    });
  }

  checkHover(mx, my) {
    if (!this.matrixData || !this.layout) return;
    const { padLeft, padTop, cellSize, n } = this.layout;

    if (mx >= padLeft && mx < padLeft + n * cellSize &&
        my >= padTop && my < padTop + n * cellSize) {
      const c = Math.floor((mx - padLeft) / cellSize);
      const r = Math.floor((my - padTop) / cellSize);
      if (r < n && c < n) {
        this.hoverCell = { r, c, mx, my };
        this.render();
        return;
      }
    }
    this.hoverCell = null;
    this.render();
  }

  render() {
    const { ctx, width, height } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    if (!this.matrixData || !this.matrixData.nodeIds || this.matrixData.nodeIds.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO MESH NODES LOADED', width / 2, height / 2);
      return;
    }

    const { nodeIds, matrix } = this.matrixData;
    const n = nodeIds.length;

    const padLeft = 40;
    const padTop = 35;
    const padRight = 80;
    const padBottom = 20;

    const availW = width - padLeft - padRight;
    const availH = height - padTop - padBottom;
    const cellSize = Math.max(12, Math.min(availW / n, availH / n));
    this.layout = { padLeft, padTop, cellSize, n };

    // Metric color mapper
    const getColor = (cell) => {
      if (cell.status === 'ABSENT') return 'rgba(30, 41, 59, 0.4)';
      if (cell.status === 'UNOBSERVED') return 'rgba(51, 65, 85, 0.35)';

      const mType = this.options.metricType;
      if (mType === 'prr') {
        const prr = cell.prr !== null ? cell.prr : 0;
        if (prr >= 90) return '#10b981';
        if (prr >= 70) return '#06b6d4';
        if (prr >= 40) return '#f59e0b';
        return '#ef4444';
      }

      if (mType === 'loss_rate') {
        const loss = cell.lossRate !== null ? cell.lossRate : 0;
        if (loss === 0) return '#10b981';
        if (loss < 20) return '#f59e0b';
        return '#ef4444';
      }

      // Default: RSSI (e.g. -135 to -50 dBm)
      const rssi = cell.rssi !== null ? cell.rssi : -140;
      if (rssi >= -75) return '#10b981';
      if (rssi >= -95) return '#06b6d4';
      if (rssi >= -115) return '#3b82f6';
      if (rssi >= -124) return '#f59e0b';
      return '#ef4444';
    };

    // Draw grid cells
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = matrix[r][c];
        const x = padLeft + c * cellSize;
        const y = padTop + r * cellSize;

        if (r === c) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(x, y, cellSize, cellSize);
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.strokeRect(x, y, cellSize, cellSize);
          continue;
        }

        ctx.fillStyle = getColor(cell);
        ctx.fillRect(x, y, cellSize, cellSize);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.strokeRect(x, y, cellSize, cellSize);

        // Pattern for unobserved vs absent
        if (cell.status === 'UNOBSERVED') {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.fillRect(x + cellSize / 2 - 1, y + cellSize / 2 - 1, 2, 2);
        }
      }
    }

    // Node ID Row/Col Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let c = 0; c < n; c++) {
      ctx.fillText(nodeIds[c], padLeft + c * cellSize + cellSize / 2, padTop - 4);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < n; r++) {
      ctx.fillText(nodeIds[r], padLeft - 6, padTop + r * cellSize + cellSize / 2);
    }

    // Title
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 12px "Outfit", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${this.options.title} [Metric: ${this.options.metricType.toUpperCase()}]`, padLeft, 8);

    // Legend sidebar
    const legX = width - padRight + 12;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const legItems = [
      { color: '#10b981', label: 'Strong (>-80dBm)' },
      { color: '#06b6d4', label: 'Good (-95dBm)' },
      { color: '#3b82f6', label: 'Fair (-115dBm)' },
      { color: '#f59e0b', label: 'Near Sens (-124)' },
      { color: '#ef4444', label: 'Sub-Sens / Drop' },
      { color: 'rgba(51, 65, 85, 0.4)', label: 'Unobserved' },
      { color: 'rgba(30, 41, 59, 0.5)', label: 'Absent / Out' }
    ];

    for (let i = 0; i < legItems.length; i++) {
      const ly = padTop + i * 18;
      ctx.fillStyle = legItems[i].color;
      ctx.fillRect(legX, ly, 10, 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(legX, ly, 10, 10);

      ctx.fillStyle = '#94a3b8';
      ctx.fillText(legItems[i].label, legX + 16, ly + 5);
    }

    // Tooltip on Hover
    if (this.hoverCell) {
      const { r, c, mx, my } = this.hoverCell;
      const cell = matrix[r][c];

      const lines = [
        `Link: Node ${cell.from} ➔ Node ${cell.to}`,
        `Status: ${cell.status}`,
        `Distance: ${cell.distanceM !== null ? cell.distanceM.toFixed(1) + ' m' : 'N/A'}`
      ];

      if (cell.status === 'MEASURED') {
        lines.push(`Samples: ${cell.samples} pkts`);
        lines.push(`RSSI: ${cell.rssi !== null ? cell.rssi + ' dBm' : 'N/A'}`);
        lines.push(`Delivery (PRR): ${cell.prr !== null ? cell.prr + '%' : 'N/A'}`);
        lines.push(`Loss Rate: ${cell.lossRate !== null ? cell.lossRate + '%' : 'N/A'}`);
        if (cell.linkMargin !== null) lines.push(`Link Margin: ${cell.linkMargin > 0 ? '+' : ''}${cell.linkMargin} dB`);
      } else if (cell.status === 'UNOBSERVED') {
        lines.push(`Predicted RSSI: ${cell.rssi !== null ? cell.rssi + ' dBm' : 'N/A'}`);
        lines.push(`Simulated Packets: 0 (No events observed yet)`);
      } else {
        lines.push(`Radio Link: Out of range or blocked`);
      }

      ctx.font = '10px "JetBrains Mono", monospace';
      const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
      const boxH = lines.length * 15 + 10;
      let bx = mx + 12;
      let by = my - 10;
      if (bx + boxW > width - 10) bx = mx - boxW - 12;
      if (by + boxH > height - 10) by = height - boxH - 10;
      if (by < 10) by = 10;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeRect(bx, by, boxW, boxH);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = i === 0 ? '#38bdf8' : (i === 1 ? (cell.status === 'MEASURED' ? '#10b981' : '#f59e0b') : '#e2e8f0');
        ctx.fillText(lines[i], bx + 8, by + 6 + i * 15);
      }
    }
  }
}

/**
 * 5. Scientific 2D Trajectory Plot (Ground Truth vs Estimated Path in Cartesian Coordinates)
 */
export class ScientificTrajectoryPlot {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.options = {
      title: options.title || 'Cartesian Trajectory & Position Estimation Error Vectors',
      showErrorVectors: options.showErrorVectors !== false,
      showOutageZones: options.showOutageZones !== false,
      ...options
    };
    this.gtPath = []; // [{ x, y, t }]
    this.estPath = []; // [{ x, y, t, gnssAvailable }]
    this.errorVectors = []; // [{ gtX, gtY, estX, estY, errorM, t }]
    this.currentPoint = null;

    this.initEvents();
  }

  setTrajectory(gtPath, estPath, errorVectors = [], currentPoint = null) {
    this.gtPath = gtPath;
    this.estPath = estPath;
    this.errorVectors = errorVectors;
    this.currentPoint = currentPoint;
    this.render();
  }

  initEvents() {
    // Zoom / pan support can be attached if needed
  }

  render() {
    const { ctx, width, height } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 55;
    const padRight = 30;
    const padTop = 32;
    const padBottom = 35;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (plotW <= 10 || plotH <= 10) return;

    const allPts = [...this.gtPath, ...this.estPath];
    if (allPts.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO TRAJECTORY DATA (SELECT A MOBILE SURVIVOR NODE)', width / 2, height / 2);
      return;
    }

    const minX = Math.min(...allPts.map(p => p.x)) - 30;
    const maxX = Math.max(...allPts.map(p => p.x)) + 30;
    const minY = Math.min(...allPts.map(p => p.y)) - 30;
    const maxY = Math.max(...allPts.map(p => p.y)) + 30;

    const scaleX = x => padLeft + ((x - minX) / (maxX - minX)) * plotW;
    const scaleY = y => padTop + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const yVal = minY + (i / 5) * (maxY - minY);
      const py = scaleY(yVal);
      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + plotW, py);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${yVal.toFixed(0)}m`, padLeft - 6, py);
    }

    for (let i = 0; i <= 5; i++) {
      const xVal = minX + (i / 5) * (maxX - minX);
      const px = scaleX(xVal);
      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + plotH);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${xVal.toFixed(0)}m`, px, padTop + plotH + 5);
    }

    // 1. Error vectors
    if (this.options.showErrorVectors) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.lineWidth = 1;
      for (const ev of this.errorVectors) {
        ctx.beginPath();
        ctx.moveTo(scaleX(ev.gtX), scaleY(ev.gtY));
        ctx.lineTo(scaleX(ev.estX), scaleY(ev.estY));
        ctx.stroke();
      }
    }

    // 2. Ground Truth Path (dashed cyan)
    if (this.gtPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < this.gtPath.length; i++) {
        const px = scaleX(this.gtPath[i].x);
        const py = scaleY(this.gtPath[i].y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Estimated Path (amber/green depending on fix)
    if (this.estPath.length > 1) {
      ctx.save();
      ctx.lineWidth = 2.5;
      for (let i = 1; i < this.estPath.length; i++) {
        const p0 = this.estPath[i - 1];
        const p1 = this.estPath[i];
        ctx.beginPath();
        ctx.moveTo(scaleX(p0.x), scaleY(p0.y));
        ctx.lineTo(scaleX(p1.x), scaleY(p1.y));
        ctx.strokeStyle = p1.gnssAvailable ? '#10b981' : '#f59e0b';
        ctx.stroke();
      }
      ctx.restore();
    }

    // 4. Current Point Markers
    if (this.currentPoint) {
      if (this.currentPoint.gt) {
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.arc(scaleX(this.currentPoint.gt.x), scaleY(this.currentPoint.gt.y), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.currentPoint.est) {
        ctx.fillStyle = this.currentPoint.est.gnssAvailable ? '#10b981' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(scaleX(this.currentPoint.est.x), scaleY(this.currentPoint.est.y), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padLeft, padTop, plotW, plotH);

    // Title and Labels
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 12px "Outfit", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(this.options.title, padLeft, 8);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Easting (m) relative to Origin', padLeft + plotW / 2, height - 8);

    // Legend
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    ctx.fillStyle = '#06b6d4';
    ctx.fillText('-- Ground Truth', width - padRight, 12);
    ctx.fillStyle = '#10b981';
    ctx.fillText('— GNSS Fix Fix', width - padRight - 90, 12);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('— DR Outage', width - padRight - 180, 12);
  }
}
