import { xyToE6, computePositionErrorM } from '../src/simulation.js';

export class TopologyVisualizer {
  constructor(canvasElement, simulationEngine) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.sim = simulationEngine;

    // Viewport transform
    this.panX = 0;
    this.panY = 0;
    this.scale = 1.0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    // Filter & display flags
    this.activeFilter = 'all'; // 'all', 'survivor', 'relay', 'hub'
    this.showLinks = true;
    this.animatePackets = true;
    this.selectedNodeId = null;
    this.hoveredNodeId = null;

    // Callbacks
    this.onNodeSelect = null;
    this.onNodeReposition = null;
    this.onNodeDrag = null;

    // Dragging state
    this.isDraggingNode = false;
    this.draggedNode = null;
    this.showRssiLabels = true;

    this.initEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Connect to simulation ticks
    this.sim.subscribe((engine, type) => {
      if (type === 'load') {
        this.fitToScreen();
      }
      this.render();
    });
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', e => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const clicked = this.getNodeAtScreenPos(mx, my);

      if (clicked) {
        this.isDraggingNode = true;
        this.draggedNode = clicked;
        this.selectedNodeId = clicked.id;
        if (this.onNodeSelect) this.onNodeSelect(clicked);
        this.render();
      } else {
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', e => {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isDraggingNode && this.draggedNode) {
          const wp = this.screenToWorld(mx, my);
          this.draggedNode.x = Math.round(wp.x * 10) / 10;
          this.draggedNode.y = Math.round(wp.y * 10) / 10;
          const geo = xyToE6(this.draggedNode.x, this.draggedNode.y);
          this.draggedNode.lat_e6 = geo.lat_e6;
          this.draggedNode.lon_e6 = geo.lon_e6;
          this.draggedNode.gt_lat_e6 = geo.lat_e6;
          this.draggedNode.gt_lon_e6 = geo.lon_e6;
          if (this.draggedNode.est_lat_e6 && this.draggedNode.est_lon_e6) {
            this.draggedNode.pos_error_m = computePositionErrorM(
              this.draggedNode.est_lat_e6,
              this.draggedNode.est_lon_e6,
              geo.lat_e6,
              geo.lon_e6
            );
          }
          if (this.onNodeDrag) {
            this.onNodeDrag(this.draggedNode);
          }
          this.render();
        } else if (this.isDragging) {
          this.panX = e.clientX - this.dragStartX;
          this.panY = e.clientY - this.dragStartY;
          this.render();
        } else {
          this.checkHover(mx, my);
        }
      });

      window.addEventListener('mouseup', () => {
        if (this.isDraggingNode && this.draggedNode) {
          const node = this.draggedNode;
          const geo = xyToE6(node.x, node.y);
          node.lat_e6 = geo.lat_e6;
          node.lon_e6 = geo.lon_e6;
          node.gt_lat_e6 = geo.lat_e6;
          node.gt_lon_e6 = geo.lon_e6;
          if (node.est_lat_e6 && node.est_lon_e6) {
            node.pos_error_m = computePositionErrorM(
              node.est_lat_e6,
              node.est_lon_e6,
              geo.lat_e6,
              geo.lon_e6
            );
          }
          if (this.onNodeReposition) {
            this.onNodeReposition(node.id, node.x, node.y);
          }
          this.isDraggingNode = false;
          this.draggedNode = null;
          this.render();
        }
        this.isDragging = false;
      });
    }

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * zoomFactor;
      this.panY = mouseY - (mouseY - this.panY) * zoomFactor;
      this.scale *= zoomFactor;
      this.render();
    }, { passive: false });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  fitToScreen() {
    if (this.sim.nodes.size === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [, n] of this.sim.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const pad = 60;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = (maxX - minX) || 1000;
    const h = (maxY - minY) || 1000;
    const scaleX = (rect.width - pad * 2) / w;
    const scaleY = (rect.height - pad * 2) / h;
    this.scale = Math.min(scaleX, scaleY, 1.2);

    this.panX = rect.width / 2 - ((minX + maxX) / 2) * this.scale;
    this.panY = rect.height / 2 - ((minY + maxY) / 2) * this.scale;
    this.render();
  }

  worldToScreen(x, y) {
    return {
      x: x * this.scale + this.panX,
      y: y * this.scale + this.panY
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale
    };
  }

  getNodeAtScreenPos(sx, sy) {
    for (const [, n] of this.sim.nodes) {
      if (!this.matchesFilter(n)) continue;
      const p = this.worldToScreen(n.x, n.y);
      const r = n.role === 'hub' ? 18 : 14;
      const dist = Math.hypot(sx - p.x, sy - p.y);
      if (dist <= r) return n;
    }
    return null;
  }

  checkHover(sx, sy) {
    const prev = this.hoveredNodeId;
    const hovered = this.getNodeAtScreenPos(sx, sy);
    this.hoveredNodeId = hovered ? hovered.id : null;
    if (prev !== this.hoveredNodeId) {
      this.updateTooltip(hovered, sx, sy);
      this.render();
    }
  }

  updateTooltip(node, sx, sy) {
    const tooltip = document.getElementById('nodeTooltip');
    if (!tooltip) return;
    if (!node) {
      tooltip.style.display = 'none';
      return;
    }

    tooltip.style.display = 'block';
    tooltip.style.left = `${sx + 15}px`;
    tooltip.style.top = `${sy + 15}px`;

    const titleEl = tooltip.querySelector('.tooltip-title');
    const contentEl = tooltip.querySelector('.tooltip-content');

    const roleName = (node && node.role ? String(node.role) : (node && node.id === 0 ? 'hub' : 'unknown')).toUpperCase();
    const statusText = !node.online ? 'OFFLINE (FAILED)' : (node.active_sos ? 'EMERGENCY ACTIVE' : 'ONLINE');
    const statusColor = !node.online ? '#ef4444' : node.active_sos ? '#ef4444' : '#10b981';
    const posX = typeof node.x === 'number' ? node.x.toFixed(0) : '0';
    const posY = typeof node.y === 'number' ? node.y.toFixed(0) : '0';
    const batt = node.battery !== undefined ? node.battery : 100;
    const txPackets = node.stats && typeof node.stats.tx === 'number' ? node.stats.tx : 0;
    const rxDelivered = node.stats && typeof node.stats.rx === 'number' ? node.stats.rx : 0;

    titleEl.innerHTML = `<span>Node ${node.id}</span> <span style="color:${statusColor}; font-size:10px">${statusText}</span>`;
    contentEl.innerHTML = `
      <div class="tooltip-row"><span>Role:</span> <span>${roleName}</span></div>
      <div class="tooltip-row"><span>Battery:</span> <span>${batt}%</span></div>
      <div class="tooltip-row"><span>Position:</span> <span>(${posX}, ${posY})</span></div>
      <div class="tooltip-row"><span>GNSS Satellites:</span> <span>${node.gnss_on ? '3D Fix' : 'Denied (DR fallback)'}</span></div>
      <div class="tooltip-row"><span>TX Packets:</span> <span>${txPackets}</span></div>
      <div class="tooltip-row"><span>RX Delivered:</span> <span>${rxDelivered}</span></div>
    `;
  }

  matchesFilter(node) {
    if (this.activeFilter === 'all') return true;
    const role = (node && node.role ? String(node.role).toLowerCase() : (node && node.id === 0 ? 'hub' : 'unknown'));
    return role === this.activeFilter;
  }

  render() {
    const ctx = this.ctx;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // 1. Grid
    this.drawGrid(rect.width, rect.height);

    // 2. Links
    if (this.showLinks) {
      this.drawLinks();
    }

    // 3. Active Packet Pulses & Transmissions
    if (this.animatePackets) {
      this.drawActivePackets();
    }

    // 4. Nodes
    if (this.sim.nodes.size === 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.font = '14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO NODES LOADED', rect.width / 2, rect.height / 2 - 12);
      ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.fillText('Connect to backend (⚡ Backend) or load a scenario to view topology', rect.width / 2, rect.height / 2 + 12);
      ctx.restore();
    } else {
      for (const [, n] of this.sim.nodes) {
        if (this.matchesFilter(n)) {
          this.drawNode(n);
        }
      }
    }
  }

  drawGrid(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    const gridSize = 100 * this.scale;
    if (gridSize > 15) {
      const offsetX = this.panX % gridSize;
      const offsetY = this.panY % gridSize;

      for (let x = offsetX; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = offsetY; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawLinks() {
    const ctx = this.ctx;
    ctx.save();

    // 1. Draw base links
    for (const link of this.sim.links) {
      const na = this.sim.nodes.get(link.a);
      const nb = this.sim.nodes.get(link.b);
      if (!na || !nb) continue;
      if (!this.matchesFilter(na) && !this.matchesFilter(nb)) continue;

      const pa = this.worldToScreen(na.x, na.y);
      const pb = this.worldToScreen(nb.x, nb.y);

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);

      if (link.blocked) {
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const alpha = Math.max(0.06, Math.min(0.35, (link.rssi + 135) / 75));
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 2. Draw highlighted links and RSSI badges for selected node
    if (this.selectedNodeId !== null && this.showRssiLabels) {
      for (const link of this.sim.links) {
        if (link.a === this.selectedNodeId || link.b === this.selectedNodeId) {
          const na = this.sim.nodes.get(link.a);
          const nb = this.sim.nodes.get(link.b);
          if (!na || !nb) continue;
          const pa = this.worldToScreen(na.x, na.y);
          const pb = this.worldToScreen(nb.x, nb.y);
          const midX = (pa.x + pb.x) / 2;
          const midY = (pa.y + pb.y) / 2;

          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // RSSI badge
          ctx.font = '10px monospace';
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(midX - 26, midY - 8, 52, 16);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1;
          ctx.strokeRect(midX - 26, midY - 8, 52, 16);
          ctx.fillStyle = '#38bdf8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${link.rssi.toFixed(0)} dBm`, midX, midY);
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }

  drawActivePackets() {
    const ctx = this.ctx;
    const t = this.sim.currentTime;

    for (const tx of this.sim.activePackets) {
      const na = this.sim.nodes.get(tx.node);
      if (!na) continue;
      const pa = this.worldToScreen(na.x, na.y);

      const air = tx.air || 62;
      const progress = Math.max(0, Math.min(1, (t - tx.t) / air));

      // Radio transmission propagation ring
      ctx.save();
      const ringRadius = progress * 140 * this.scale;
      ctx.beginPath();
      ctx.arc(pa.x, pa.y, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = tx.ack ? 'rgba(16, 185, 129, 0.5)' : 'rgba(6, 182, 212, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Filled glow
      ctx.fillStyle = tx.ack ? 'rgba(16, 185, 129, 0.08)' : 'rgba(6, 182, 212, 0.08)';
      ctx.fill();
      ctx.restore();
    }
  }

  drawNode(n) {
    const ctx = this.ctx;
    const p = this.worldToScreen(n.x, n.y);
    const isSelected = n.id === this.selectedNodeId;
    const isHovered = n.id === this.hoveredNodeId;

    ctx.save();

    // Selection Halo
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Emergency Pulse Ring
    if (n.active_sos && n.online) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18 + (this.sim.currentTime % 1000) / 100, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239, 68, 68, ${1 - (this.sim.currentTime % 1000) / 1000})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Node Shape & Color by Role
    if (!n.online) {
      // Offline / killed node
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.stroke();

      // Red X
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 5);
      ctx.moveTo(p.x + 5, p.y - 5);
      ctx.lineTo(p.x - 5, p.y + 5);
      ctx.stroke();
    } else if (n.role === 'hub') {
      // Hub Node: Diamond star with emerald glow
      ctx.fillStyle = '#10b981';
      ctx.shadowColor = 'rgba(16, 185, 129, 0.8)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 12);
      ctx.lineTo(p.x + 12, p.y);
      ctx.lineTo(p.x, p.y + 12);
      ctx.lineTo(p.x - 12, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (n.role === 'relay') {
      // Relay Node: Amber diamond
      ctx.fillStyle = '#f59e0b';
      ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 9);
      ctx.lineTo(p.x + 9, p.y);
      ctx.lineTo(p.x, p.y + 9);
      ctx.lineTo(p.x - 9, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (n.role === 'survivor') {
      // Survivor Node: Circle (Cyan normally, Red if SOS, Emerald if ACK confirmed)
      ctx.fillStyle = n.active_sos ? '#ef4444' : n.acked ? '#10b981' : '#06b6d4';
      ctx.shadowColor = n.active_sos ? 'rgba(239, 68, 68, 0.8)' : n.acked ? 'rgba(16, 185, 129, 0.8)' : 'rgba(6, 182, 212, 0.6)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ACK Confirmed Checkmark Ring
      if (n.acked && !n.active_sos) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      // Unknown or Custom Role: Neutral slate circle with distinct light ring
      ctx.fillStyle = '#64748b';
      ctx.shadowColor = 'rgba(100, 116, 139, 0.5)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Battery bar below node
    if (n.online) {
      const bw = 18;
      const bh = 3;
      const bx = p.x - bw / 2;
      const by = p.y + 12;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(bx, by, bw, bh);
      const bColor = n.battery < 20 ? '#ef4444' : n.battery < 50 ? '#f59e0b' : '#10b981';
      ctx.fillStyle = bColor;
      ctx.fillRect(bx, by, (bw * Math.max(0, Math.min(100, n.battery))) / 100, bh);
    }

    // Node Label
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '600 10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(n.id), p.x, p.y - 15);

    ctx.restore();
  }
}
