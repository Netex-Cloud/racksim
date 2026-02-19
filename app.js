
import { LitElement, html } from "lit";
import rackData from "./rack-data.json" with { type: "json" };

const TYPE_BADGE = {
  ups: "text-bg-danger",
  ats: "text-bg-warning",
  netapp: "text-bg-primary",
  fujitsu: "text-bg-info",
  blade: "text-bg-secondary",
  switch: "text-bg-success",
  storage: "text-bg-dark",
  empty: "text-bg-light"
};

const CABLE_BADGE = {
  dac: "text-bg-warning",
  aoc: "text-bg-primary",
  fiber: "text-bg-success"
};

const PORT_TYPES = ["1GbaseT", "10GbaseT", "sfp", "sfp+", "sfp28", "qsfp", "qsfp28"];
const CABLE_TYPES = ["aoc", "dac", "fiber"];
const CABLE_SPEEDS = ["1G", "10G", "25G", "40G", "100G"];

class RackApp extends LitElement {
  static properties = {
    data: { state: true },
    viewMode: { state: true },
    dragOverU: { state: true },
    newEquipmentName: { state: true },
    newEquipmentHeight: { state: true },
    newEquipmentType: { state: true },
    newEquipmentDescription: { state: true },
    newEquipmentBrand: { state: true },
    newEquipmentModel: { state: true },
    newCable: { state: true }
  };

  constructor() {
    super();
    this.data = structuredClone(rackData);
    this.viewMode = "front";
    this.dragOverU = null;

    this.newEquipmentName = "";
    this.newEquipmentHeight = 1;
    this.newEquipmentType = "switch";
    this.newEquipmentDescription = "";
    this.newEquipmentBrand = "";
    this.newEquipmentModel = "";

    this.newCable = {
      name: "",
      quantity: 1,
      portType1: "sfp28",
      portType2: "sfp28",
      cableType: "dac",
      speed: "25G",
      length: "3m"
    };
  }

  createRenderRoot() {
    return this;
  }

  get rackRows() {
    return Array.from({ length: this.data.rack.totalU }, (_, index) => this.data.rack.totalU - index);
  }

  get equipmentMap() {
    return new Map(this.data.equipments.map((equipment) => [equipment.id, equipment]));
  }

  get cableMap() {
    return new Map((this.data.cablesInventory || []).map((cable) => [cable.id, cable]));
  }

  get occupancyMap() {
    const occupancy = new Map();
    for (const [uText, equipmentId] of Object.entries(this.data.rack.slots || {})) {
      const startU = Number(uText);
      const equipment = this.equipmentMap.get(equipmentId);
      if (!equipment) continue;
      const endU = startU - equipment.heightU + 1;
      for (let u = startU; u >= endU; u -= 1) {
        if (u < 1 || u > this.data.rack.totalU) continue;
        if (occupancy.has(u)) continue;
        occupancy.set(u, { equipment, startU, endU, isStart: u === startU });
      }
    }
    return occupancy;
  }

  getPlacedInfo(u) {
    return this.occupancyMap.get(u) || null;
  }

  isEquipmentPlaced(equipmentId) {
    return Object.values(this.data.rack.slots || {}).includes(equipmentId);
  }

  getCableAvailableQuantity(cableId) {
    const cable = this.cableMap.get(cableId);
    if (!cable) return 0;
    const used = (this.data.cableAttachments || []).filter((item) => item.cableId === cableId).length;
    return Math.max(0, Number(cable.quantity || 0) - used);
  }

  setRackHeight(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 12 || parsed > 60) return;

    const nextSlots = {};
    for (const [uText, equipmentId] of Object.entries(this.data.rack.slots || {})) {
      const startU = Number(uText);
      const equipment = this.equipmentMap.get(equipmentId);
      if (!equipment) continue;
      const endU = startU - equipment.heightU + 1;
      if (startU <= parsed && endU >= 1) nextSlots[String(startU)] = equipmentId;
    }

    this.data = { ...this.data, rack: { ...this.data.rack, totalU: parsed, slots: nextSlots } };
  }

  canPlaceEquipment(equipmentId, startU, ignoreIds = new Set()) {
    const equipment = this.equipmentMap.get(equipmentId);
    if (!equipment) return false;
    const endU = startU - equipment.heightU + 1;
    if (startU > this.data.rack.totalU || endU < 1) return false;
    for (let u = startU; u >= endU; u -= 1) {
      const existing = this.occupancyMap.get(u);
      if (existing && !ignoreIds.has(existing.equipment.id)) return false;
    }
    return true;
  }

  replaceSlots(nextSlots) {
    this.data = { ...this.data, rack: { ...this.data.rack, slots: nextSlots } };
  }

  onSlotDragStart(event, sourceU) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "slot", sourceU }));
  }

  onEquipmentDragStart(event, equipmentId) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "inventory", equipmentId }));
  }

  onCableDragStart(event, cableId) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: "cable", cableId }));
  }

  allowDrop(event, targetU) {
    event.preventDefault();
    this.dragOverU = targetU;
    event.dataTransfer.dropEffect = "move";
  }

  clearDropState() {
    this.dragOverU = null;
  }

  attachCableToEquipment(cableId, equipmentId) {
    const available = this.getCableAvailableQuantity(cableId);
    if (available <= 0) {
      alert("No remaining cable quantity for this item.");
      return;
    }
    const attachment = { id: `att-${crypto.randomUUID()}`, cableId, equipmentId };
    this.data = { ...this.data, cableAttachments: [...(this.data.cableAttachments || []), attachment] };
  }

  onDropToSlot(event, targetU) {
    event.preventDefault();
    this.dragOverU = null;

    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/json"));
    } catch {
      return;
    }

    const occupancy = this.occupancyMap;
    const targetInfo = occupancy.get(targetU) || null;

    if (payload.kind === "cable") {
      if (this.viewMode !== "rear" || !targetInfo || !targetInfo.isStart) return;
      this.attachCableToEquipment(payload.cableId, targetInfo.equipment.id);
      return;
    }

    if (payload.kind === "inventory") {
      const equipment = this.equipmentMap.get(payload.equipmentId);
      if (!equipment) return;
      if (!this.canPlaceEquipment(equipment.id, targetU)) {
        alert(`Cannot place ${equipment.name}: not enough contiguous ${equipment.heightU}U space.`);
        return;
      }
      const nextSlots = { ...(this.data.rack.slots || {}) };
      for (const [key, value] of Object.entries(nextSlots)) if (value === equipment.id) delete nextSlots[key];
      nextSlots[String(targetU)] = equipment.id;
      this.replaceSlots(nextSlots);
      return;
    }

    if (payload.kind !== "slot") return;

    const sourceInfo = occupancy.get(payload.sourceU) || null;
    if (!sourceInfo && !targetInfo) return;
    const nextSlots = { ...(this.data.rack.slots || {}) };

    if (sourceInfo && !targetInfo) {
      const sourceId = sourceInfo.equipment.id;
      const sourceStart = sourceInfo.startU;
      if (!this.canPlaceEquipment(sourceId, targetU, new Set([sourceId]))) {
        alert("Cannot move equipment there: not enough contiguous free U space.");
        return;
      }
      delete nextSlots[String(sourceStart)];
      nextSlots[String(targetU)] = sourceId;
      this.replaceSlots(nextSlots);
      return;
    }

    if (!sourceInfo && targetInfo) {
      const targetId = targetInfo.equipment.id;
      const targetStart = targetInfo.startU;
      if (!this.canPlaceEquipment(targetId, payload.sourceU, new Set([targetId]))) {
        alert("Cannot move equipment there: not enough contiguous free U space.");
        return;
      }
      delete nextSlots[String(targetStart)];
      nextSlots[String(payload.sourceU)] = targetId;
      this.replaceSlots(nextSlots);
      return;
    }

    const sourceId = sourceInfo.equipment.id;
    const sourceStart = sourceInfo.startU;
    const targetId = targetInfo.equipment.id;
    const targetStart = targetInfo.startU;
    if (sourceId === targetId) return;

    const ignoreIds = new Set([sourceId, targetId]);
    const sourceCanFit = this.canPlaceEquipment(sourceId, targetStart, ignoreIds);
    const targetCanFit = this.canPlaceEquipment(targetId, sourceStart, ignoreIds);
    if (!sourceCanFit || !targetCanFit) {
      alert("Swap cannot be done due to height/space constraints.");
      return;
    }

    delete nextSlots[String(sourceStart)];
    delete nextSlots[String(targetStart)];
    nextSlots[String(targetStart)] = sourceId;
    nextSlots[String(sourceStart)] = targetId;
    this.replaceSlots(nextSlots);
  }

  removeFromRack(startU) {
    const nextSlots = { ...(this.data.rack.slots || {}) };
    delete nextSlots[String(startU)];
    this.replaceSlots(nextSlots);
  }

  addEquipment(event) {
    event.preventDefault();
    const name = this.newEquipmentName.trim();
    const heightU = Number(this.newEquipmentHeight);
    if (!name || !Number.isInteger(heightU) || heightU < 1 || heightU > 20) return;

    const equipment = {
      id: `eq-custom-${crypto.randomUUID()}`,
      name,
      description: this.newEquipmentDescription.trim(),
      brand: this.newEquipmentBrand.trim(),
      model: this.newEquipmentModel.trim(),
      heightU,
      type: this.newEquipmentType,
      ports: [{ count: 1, portType: "10GbaseT" }],
      rearPorts: []
    };
    this.data = { ...this.data, equipments: [...this.data.equipments, equipment] };
    this.newEquipmentName = "";
    this.newEquipmentDescription = "";
    this.newEquipmentBrand = "";
    this.newEquipmentModel = "";
    this.newEquipmentHeight = 1;
    this.newEquipmentType = "switch";
  }

  updateEquipmentField(equipmentId, field, value) {
    const nextEquipments = this.data.equipments.map((equipment) => {
      if (equipment.id !== equipmentId) return equipment;
      const next = { ...equipment };
      next[field] = field === "heightU" ? Math.max(1, Math.min(20, Number(value) || 1)) : value;
      return next;
    });
    this.data = { ...this.data, equipments: nextEquipments };
  }

  addPortProfile(equipmentId) {
    const nextEquipments = this.data.equipments.map((equipment) =>
      equipment.id !== equipmentId
        ? equipment
        : { ...equipment, ports: [...(equipment.ports || []), { count: 1, portType: "10GbaseT" }] }
    );
    this.data = { ...this.data, equipments: nextEquipments };
  }

  updatePortProfile(equipmentId, index, field, value) {
    const nextEquipments = this.data.equipments.map((equipment) => {
      if (equipment.id !== equipmentId) return equipment;
      const nextPorts = [...(equipment.ports || [])];
      const current = { ...(nextPorts[index] || { count: 1, portType: "10GbaseT" }) };
      current[field] = field === "count" ? Math.max(1, Number(value) || 1) : value;
      nextPorts[index] = current;
      return { ...equipment, ports: nextPorts };
    });
    this.data = { ...this.data, equipments: nextEquipments };
  }

  removePortProfile(equipmentId, index) {
    const nextEquipments = this.data.equipments.map((equipment) => {
      if (equipment.id !== equipmentId) return equipment;
      const nextPorts = [...(equipment.ports || [])];
      nextPorts.splice(index, 1);
      return { ...equipment, ports: nextPorts.length ? nextPorts : [{ count: 1, portType: "10GbaseT" }] };
    });
    this.data = { ...this.data, equipments: nextEquipments };
  }

  addCable(event) {
    event.preventDefault();
    const name = this.newCable.name.trim();
    if (!name) return;
    const cable = {
      id: `cb-${crypto.randomUUID()}`,
      name,
      quantity: Math.max(1, Number(this.newCable.quantity) || 1),
      portType1: this.newCable.portType1,
      portType2: this.newCable.portType2,
      cableType: this.newCable.cableType,
      speed: this.newCable.speed,
      length: this.newCable.length.trim() || "1m"
    };
    this.data = { ...this.data, cablesInventory: [...(this.data.cablesInventory || []), cable] };
    this.newCable = {
      name: "",
      quantity: 1,
      portType1: "sfp28",
      portType2: "sfp28",
      cableType: "dac",
      speed: "25G",
      length: "3m"
    };
  }

  updateCableField(cableId, field, value) {
    const next = (this.data.cablesInventory || []).map((cable) => {
      if (cable.id !== cableId) return cable;
      return { ...cable, [field]: field === "quantity" ? Math.max(0, Number(value) || 0) : value };
    });
    this.data = { ...this.data, cablesInventory: next };
  }

  removeCableAttachment(attachmentId) {
    this.data = {
      ...this.data,
      cableAttachments: (this.data.cableAttachments || []).filter((row) => row.id !== attachmentId)
    };
  }

  formatPorts(equipment) {
    const rows = equipment.ports || [];
    return rows.map((row) => `${row.count}x ${row.portType}`).join(", ");
  }

  exportJson() {
    const payload = JSON.stringify(this.data, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rack-layout.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async importJson(event) {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.rack?.totalU || !Array.isArray(parsed?.equipments)) throw new Error("Invalid schema");
      this.data = parsed;
    } catch {
      alert("Invalid JSON file.");
    } finally {
      event.target.value = "";
    }
  }

  renderEquipmentCard(equipment) {
    const placed = this.isEquipmentPlaced(equipment.id);
    const badge = TYPE_BADGE[equipment.type] || "text-bg-secondary";
    return html`
      <div class="border rounded p-2">
        <div class="d-flex align-items-center gap-2 mb-2">
          <span class="badge ${badge}">${equipment.type}</span>
          <strong>${equipment.name || "Unnamed"}</strong>
          <span class="badge text-bg-light">${equipment.heightU}U</span>
          ${placed ? html`<span class="badge text-bg-dark">Placed</span>` : html`<span class="badge text-bg-secondary">Unplaced</span>`}
          <button
            class="btn btn-sm btn-outline-primary ms-auto"
            ?disabled=${placed}
            draggable=${!placed ? "true" : "false"}
            @dragstart=${(event) => this.onEquipmentDragStart(event, equipment.id)}
          >
            Drag
          </button>
        </div>
        <div class="row g-2">
          <div class="col-12 col-md-6"><input class="form-control form-control-sm" .value=${equipment.name || ""} placeholder="Name" @input=${(e) => this.updateEquipmentField(equipment.id, "name", e.target.value)} /></div>
          <div class="col-6 col-md-3"><input class="form-control form-control-sm" .value=${equipment.brand || ""} placeholder="Brand" @input=${(e) => this.updateEquipmentField(equipment.id, "brand", e.target.value)} /></div>
          <div class="col-6 col-md-3"><input class="form-control form-control-sm" .value=${equipment.model || ""} placeholder="Model" @input=${(e) => this.updateEquipmentField(equipment.id, "model", e.target.value)} /></div>
          <div class="col-9"><input class="form-control form-control-sm" .value=${equipment.description || ""} placeholder="Description" @input=${(e) => this.updateEquipmentField(equipment.id, "description", e.target.value)} /></div>
          <div class="col-3"><input type="number" min="1" max="20" class="form-control form-control-sm" .value=${String(equipment.heightU || 1)} @input=${(e) => this.updateEquipmentField(equipment.id, "heightU", e.target.value)} /></div>
        </div>
        <div class="mt-2">
          <div class="d-flex justify-content-between align-items-center">
            <small class="text-muted">Port profiles</small>
            <button class="btn btn-sm btn-outline-secondary" @click=${() => this.addPortProfile(equipment.id)}>+ Port</button>
          </div>
          <div class="vstack gap-1 mt-1">
            ${(equipment.ports || []).map(
              (port, index) => html`
                <div class="d-flex gap-1">
                  <input type="number" min="1" class="form-control form-control-sm" style="max-width:5rem;" .value=${String(port.count || 1)} @input=${(e) => this.updatePortProfile(equipment.id, index, "count", e.target.value)} />
                  <select class="form-select form-select-sm" .value=${port.portType || "10GbaseT"} @change=${(e) => this.updatePortProfile(equipment.id, index, "portType", e.target.value)}>
                    ${PORT_TYPES.map((option) => html`<option value=${option}>${option}</option>`)}
                  </select>
                  <button class="btn btn-sm btn-outline-danger" @click=${() => this.removePortProfile(equipment.id, index)}>x</button>
                </div>
              `
            )}
          </div>
        </div>
      </div>
    `;
  }

  renderCableCard(cable) {
    const available = this.getCableAvailableQuantity(cable.id);
    return html`
      <div class="border rounded p-2">
        <div class="d-flex align-items-center gap-2 mb-2">
          <span class="badge ${CABLE_BADGE[cable.cableType] || "text-bg-secondary"}">${cable.cableType}</span>
          <strong>${cable.name}</strong>
          <span class="badge text-bg-light">${available}/${cable.quantity} free</span>
          <button class="btn btn-sm btn-outline-primary ms-auto" draggable="true" @dragstart=${(event) => this.onCableDragStart(event, cable.id)} title="Drag to rear-view equipment">Drag Cable</button>
        </div>
        <div class="row g-2">
          <div class="col-12 col-md-4"><input class="form-control form-control-sm" .value=${cable.name || ""} placeholder="Name" @input=${(e) => this.updateCableField(cable.id, "name", e.target.value)} /></div>
          <div class="col-6 col-md-2"><input type="number" min="0" class="form-control form-control-sm" .value=${String(cable.quantity || 0)} @input=${(e) => this.updateCableField(cable.id, "quantity", e.target.value)} /></div>
          <div class="col-6 col-md-2"><input class="form-control form-control-sm" .value=${cable.length || ""} placeholder="Length" @input=${(e) => this.updateCableField(cable.id, "length", e.target.value)} /></div>
          <div class="col-6 col-md-2"><select class="form-select form-select-sm" .value=${cable.speed || "10G"} @change=${(e) => this.updateCableField(cable.id, "speed", e.target.value)}>${CABLE_SPEEDS.map((option) => html`<option value=${option}>${option}</option>`)}</select></div>
          <div class="col-6 col-md-2"><select class="form-select form-select-sm" .value=${cable.cableType || "dac"} @change=${(e) => this.updateCableField(cable.id, "cableType", e.target.value)}>${CABLE_TYPES.map((option) => html`<option value=${option}>${option}</option>`)}</select></div>
          <div class="col-6"><select class="form-select form-select-sm" .value=${cable.portType1 || "sfp28"} @change=${(e) => this.updateCableField(cable.id, "portType1", e.target.value)}>${PORT_TYPES.map((option) => html`<option value=${option}>Port 1: ${option}</option>`)}</select></div>
          <div class="col-6"><select class="form-select form-select-sm" .value=${cable.portType2 || "sfp28"} @change=${(e) => this.updateCableField(cable.id, "portType2", e.target.value)}>${PORT_TYPES.map((option) => html`<option value=${option}>Port 2: ${option}</option>`)}</select></div>
        </div>
      </div>
    `;
  }

  renderRackRow(u) {
    const placed = this.getPlacedInfo(u);
    const isRear = this.viewMode === "rear";
    const isStart = Boolean(placed?.isStart);
    const equipment = placed?.equipment || null;
    const badge = TYPE_BADGE[equipment?.type] || "text-bg-light";
    const highlight = this.dragOverU === u ? "border-primary" : "border-secondary-subtle";
    const above = this.getPlacedInfo(u + 1);
    const below = this.getPlacedInfo(u - 1);
    const sameAbove = Boolean(placed && above && above.equipment.id === equipment.id);
    const sameBelow = Boolean(placed && below && below.equipment.id === equipment.id);
    const rowGapClass = sameBelow ? "mb-0" : "mb-1";
    const blockStyle = placed
      ? `border-top-left-radius:${sameAbove ? "0" : "0.375rem"};
         border-top-right-radius:${sameAbove ? "0" : "0.375rem"};
         border-bottom-left-radius:${sameBelow ? "0" : "0.375rem"};
         border-bottom-right-radius:${sameBelow ? "0" : "0.375rem"};
         border-top-width:${sameAbove ? "0" : "1px"};`
      : "";
    const attachmentCount = equipment ? (this.data.cableAttachments || []).filter((item) => item.equipmentId === equipment.id).length : 0;

    return html`
      <div class="d-flex align-items-stretch gap-2 ${rowGapClass}" style="min-height:2.25rem;">
        <span class="badge text-bg-dark d-flex align-items-center justify-content-center" style="width:3rem;min-height:2.25rem;">U${u}</span>
        <div
          class="border d-flex align-items-center px-2 py-1 flex-grow-1 ${highlight} ${placed ? badge : ""}"
          style=${blockStyle}
          draggable="true"
          @dragstart=${(event) => this.onSlotDragStart(event, u)}
          @dragover=${(event) => this.allowDrop(event, u)}
          @dragleave=${() => this.clearDropState()}
          @drop=${(event) => this.onDropToSlot(event, u)}
          title=${isRear ? "Drop cable or move equipment" : "Drop equipment or move equipment"}
        >
          ${!placed
            ? html`<span class="text-muted">Empty rack unit space</span>`
            : html`
                ${isStart
                  ? html`
                      <span class="badge bg-light text-dark">${equipment.type}</span>
                      <span class="ms-2 fw-semibold">${equipment.name}</span>
                      <span class="badge text-bg-light ms-2">${equipment.heightU}U</span>
                      <span class="small ms-2 opacity-75">${equipment.brand || ""} ${equipment.model || ""}</span>
                      <span class="small ms-2 opacity-75">${this.formatPorts(equipment)}</span>
                      ${isRear ? html`<span class="badge text-bg-info ms-2">${attachmentCount} cable(s)</span>` : ""}
                      <button class="btn btn-sm btn-outline-danger ms-auto" @click=${() => this.removeFromRack(placed.startU)}>Remove</button>
                    `
                  : html``}
              `}
        </div>
        <span class="badge text-bg-dark d-flex align-items-center justify-content-center" style="width:3rem;min-height:2.25rem;">U${u}</span>
      </div>
    `;
  }

  renderRearConnections() {
    return html`
      <div class="card mt-3">
        <div class="card-header py-2"><strong>Rear Cable Connections</strong></div>
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead>
              <tr><th>Source</th><th>Port</th><th>Target</th><th>Target Port</th><th>Cable</th></tr>
            </thead>
            <tbody>
              ${(this.data.rearConnections || []).map((row) => {
                const source = this.equipmentMap.get(row.fromEquipmentId)?.name || row.fromEquipmentId;
                return html`<tr><td>${source}</td><td>${row.fromPort}</td><td>${row.to}</td><td>${row.toPort}</td><td><span class="badge text-bg-secondary">${row.cable}</span></td></tr>`;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card mt-3">
        <div class="card-header py-2"><strong>Cable Attachments (Drag cable onto rear rack equipment)</strong></div>
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead>
              <tr><th>Equipment</th><th>Cable</th><th>Attributes</th><th></th></tr>
            </thead>
            <tbody>
              ${(this.data.cableAttachments || []).length === 0
                ? html`<tr><td colspan="4" class="text-muted">No cable attachments yet.</td></tr>`
                : (this.data.cableAttachments || []).map((attachment) => {
                    const equipment = this.equipmentMap.get(attachment.equipmentId);
                    const cable = this.cableMap.get(attachment.cableId);
                    if (!equipment || !cable) return "";
                    return html`
                      <tr>
                        <td>${equipment.name}</td>
                        <td>${cable.name}</td>
                        <td>
                          <span class="badge ${CABLE_BADGE[cable.cableType] || "text-bg-secondary"}">${cable.cableType}</span>
                          <span class="badge text-bg-light">${cable.speed}</span>
                          <span class="badge text-bg-light">${cable.length}</span>
                          <span class="badge text-bg-light">${cable.portType1} -> ${cable.portType2}</span>
                        </td>
                        <td><button class="btn btn-sm btn-outline-danger" @click=${() => this.removeCableAttachment(attachment.id)}>Remove</button></td>
                      </tr>
                    `;
                  })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderEquipmentInventory() {
    return html`
      <div class="card">
        <div class="card-header py-2 d-flex justify-content-between align-items-center">
          <strong>Equipment Inventory</strong>
          <small class="text-muted">Existing items are editable. Unplaced items are draggable.</small>
        </div>
        <div class="card-body">
          <form class="row g-2 mb-3" @submit=${this.addEquipment}>
            <div class="col-12 col-md-6"><input class="form-control form-control-sm" placeholder="Name" .value=${this.newEquipmentName} @input=${(e) => (this.newEquipmentName = e.target.value)} /></div>
            <div class="col-6 col-md-3"><input class="form-control form-control-sm" placeholder="Brand" .value=${this.newEquipmentBrand} @input=${(e) => (this.newEquipmentBrand = e.target.value)} /></div>
            <div class="col-6 col-md-3"><input class="form-control form-control-sm" placeholder="Model" .value=${this.newEquipmentModel} @input=${(e) => (this.newEquipmentModel = e.target.value)} /></div>
            <div class="col-9"><input class="form-control form-control-sm" placeholder="Description" .value=${this.newEquipmentDescription} @input=${(e) => (this.newEquipmentDescription = e.target.value)} /></div>
            <div class="col-3"><input type="number" min="1" max="20" class="form-control form-control-sm" .value=${String(this.newEquipmentHeight)} @input=${(e) => (this.newEquipmentHeight = e.target.value)} /></div>
            <div class="col-8">
              <select class="form-select form-select-sm" .value=${this.newEquipmentType} @change=${(e) => (this.newEquipmentType = e.target.value)}>
                <option value="switch">Switch</option>
                <option value="netapp">NetApp</option>
                <option value="fujitsu">Fujitsu</option>
                <option value="ups">UPS</option>
                <option value="ats">ATS</option>
                <option value="blade">Blade</option>
                <option value="storage">Storage</option>
              </select>
            </div>
            <div class="col-4"><button class="btn btn-sm btn-primary w-100" type="submit">Add Equipment</button></div>
          </form>
          <div class="vstack gap-2" style="max-height:36rem;overflow:auto;">${this.data.equipments.map((equipment) => this.renderEquipmentCard(equipment))}</div>
        </div>
      </div>
    `;
  }

  renderCableInventory() {
    return html`
      <div class="card mt-3">
        <div class="card-header py-2 d-flex justify-content-between align-items-center">
          <strong>Cable Inventory</strong>
          <small class="text-muted">Drag cable items to rear-view rack equipment.</small>
        </div>
        <div class="card-body">
          <form class="row g-2 mb-3" @submit=${this.addCable}>
            <div class="col-12 col-md-4"><input class="form-control form-control-sm" placeholder="Cable name" .value=${this.newCable.name} @input=${(e) => (this.newCable = { ...this.newCable, name: e.target.value })} /></div>
            <div class="col-6 col-md-2"><input type="number" min="1" class="form-control form-control-sm" .value=${String(this.newCable.quantity)} @input=${(e) => (this.newCable = { ...this.newCable, quantity: e.target.value })} /></div>
            <div class="col-6 col-md-2"><input class="form-control form-control-sm" placeholder="Length" .value=${this.newCable.length} @input=${(e) => (this.newCable = { ...this.newCable, length: e.target.value })} /></div>
            <div class="col-6 col-md-2"><select class="form-select form-select-sm" .value=${this.newCable.cableType} @change=${(e) => (this.newCable = { ...this.newCable, cableType: e.target.value })}>${CABLE_TYPES.map((option) => html`<option value=${option}>${option}</option>`)}</select></div>
            <div class="col-6 col-md-2"><select class="form-select form-select-sm" .value=${this.newCable.speed} @change=${(e) => (this.newCable = { ...this.newCable, speed: e.target.value })}>${CABLE_SPEEDS.map((option) => html`<option value=${option}>${option}</option>`)}</select></div>
            <div class="col-6"><select class="form-select form-select-sm" .value=${this.newCable.portType1} @change=${(e) => (this.newCable = { ...this.newCable, portType1: e.target.value })}>${PORT_TYPES.map((option) => html`<option value=${option}>Port 1: ${option}</option>`)}</select></div>
            <div class="col-6"><select class="form-select form-select-sm" .value=${this.newCable.portType2} @change=${(e) => (this.newCable = { ...this.newCable, portType2: e.target.value })}>${PORT_TYPES.map((option) => html`<option value=${option}>Port 2: ${option}</option>`)}</select></div>
            <div class="col-12"><button class="btn btn-sm btn-primary w-100" type="submit">Add Cable</button></div>
          </form>
          <div class="vstack gap-2" style="max-height:28rem;overflow:auto;">${(this.data.cablesInventory || []).map((cable) => this.renderCableCard(cable))}</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="container-fluid py-4">
        <div class="card shadow-sm">
          <div class="card-header bg-dark text-white py-3">
            <h1 class="h4 mb-1">${this.data.title}</h1>
            <p class="mb-0 text-white-50">${this.data.subtitle}</p>
          </div>
          <div class="card-body">
            <div class="d-flex flex-wrap gap-2 mb-3">
              <button class="btn btn-outline-primary btn-sm" @click=${this.exportJson}>Export JSON</button>
              <label class="btn btn-outline-secondary btn-sm mb-0">Import JSON<input type="file" accept="application/json" class="d-none" @change=${this.importJson} /></label>
            </div>
            <div class="row g-3 mb-3">
              <div class="col-12 col-lg-6">
                <div class="input-group input-group-sm">
                  <span class="input-group-text">Rack Height</span>
                  <input type="number" class="form-control" min="12" max="60" .value=${String(this.data.rack.totalU)} @change=${(e) => this.setRackHeight(e.target.value)} />
                  <span class="input-group-text">U</span>
                </div>
              </div>
              <div class="col-12 col-lg-6">
                <div class="btn-group btn-group-sm" role="group">
                  <button type="button" class=${`btn ${this.viewMode === "front" ? "btn-primary" : "btn-outline-primary"}`} @click=${() => (this.viewMode = "front")}>Front View</button>
                  <button type="button" class=${`btn ${this.viewMode === "rear" ? "btn-primary" : "btn-outline-primary"}`} @click=${() => (this.viewMode = "rear")}>Rear View</button>
                </div>
              </div>
            </div>
            <div class="row g-3">
              <div class="col-12 col-xl-5">${this.renderEquipmentInventory()} ${this.renderCableInventory()}</div>
              <div class="col-12 col-xl-7">
                <div class="card">
                  <div class="card-header py-2 d-flex justify-content-between align-items-center">
                    <strong>${this.viewMode === "front" ? "Front Rack View" : "Rear Rack View"}</strong>
                    <small class="text-muted">Unit tags have consistent height. Multi-U equipment is contiguous.</small>
                  </div>
                  <div class="card-body" style="max-height:78vh;overflow:auto;">${this.rackRows.map((u) => this.renderRackRow(u))}</div>
                </div>
                ${this.viewMode === "rear" ? this.renderRearConnections() : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("rack-app", RackApp);
