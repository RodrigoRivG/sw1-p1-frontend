import {
  Component, inject, signal, computed, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, NgZone, HostListener
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, PercentPipe } from '@angular/common';
import * as joint from '@joint/core';
import { PolicyService } from '../../core/services/policy.service';
import { PolicyRequest, DbDocument, PermissionLevel } from '../../core/models';
import { UserService } from '../../core/services/user.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { IaService } from '../../core/services/ia.service';
import { DocumentService } from '../../core/services/document.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { PredictionService, BestRouteResponse } from '../../core/services/prediction.service';

// ─── Types ────────────────────────────────────────────────────────────────────
export type NodeType = 'start' | 'end' | 'task' | 'decision' | 'fork' | 'join';

export interface DiagramSwimlane {
  id: string;
  label: string;
  color: string;
}

export const NODE_PALETTE = [
  { type: 'start' as NodeType, label: 'Inicio', icon: '▶', color: '#10d9a0' },
  { type: 'task' as NodeType, label: 'Tarea', icon: '☐', color: '#5b6ef0' },
  { type: 'decision' as NodeType, label: 'Decisión', icon: '◇', color: '#f59e0b' },
  { type: 'fork' as NodeType, label: 'Fork', icon: '⑂', color: '#8b5cf6' },
  { type: 'join' as NodeType, label: 'Join', icon: '⑁', color: '#8b5cf6' },
  { type: 'end' as NodeType, label: 'Fin', icon: '■', color: '#ef4444' },
];

const COLORS = ['#5b6ef0', '#10d9a0', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// ─── Layout constants ─────────────────────────────────────────────────────────
export const COL_WIDTH = 220;   // px width of each swimlane column
// HEADER_H = 44;    // px height of swimlane header strip
export const HEADER_H = 44;    // px height of swimlane header strip
export const ROW_SPACING = 110;   // px vertical gap between node rows
export const START_Y = 70;    // first node Y offset (below header)

const NODE_SIZE: Record<NodeType, { w: number; h: number }> = {
  start: { w: 36, h: 36 },
  end: { w: 36, h: 36 },
  task: { w: 120, h: 48 },
  decision: { w: 80, h: 56 },
  fork: { w: 90, h: 10 },
  join: { w: 90, h: 10 },
};

// ─── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-designer',
  standalone: true,
  imports: [NgIf, NgFor, FormsModule, RouterLink, PercentPipe],
  templateUrl: './designer.component.html',
  styleUrl: './designer.component.scss'
})
export class DesignerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('jointCanvas') canvasRef!: ElementRef<HTMLDivElement>;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private policySvc = inject(PolicyService);
  private userSvc = inject(UserService);
  private wsSvc = inject(WebsocketService);
  private iaSvc = inject(IaService);
  private docSvc = inject(DocumentService);
  private analyticsSvc = inject(AnalyticsService);
  private predictionSvc = inject(PredictionService);
  private zone = inject(NgZone);

  // ── Policy meta ───────────────────────────────────────────────
  policyId = signal<string | null>(null);
  policyName = signal('Nueva Política');
  policyDesc = signal('');
  loading = signal(false);

  // Best Route Recommendation Signals
  bestRouteSuggestion = signal<BestRouteResponse | null>(null);
  nodeAvgTimesMap = new Map<string, number>();
  saving = signal(false);

  // ── Diagram data ──────────────────────────────────────────────
  swimlanes = signal<DiagramSwimlane[]>([]);
  collaborators = signal<string[]>([]);

  // Paper dimensions (kept in sync between HTML layer and JointJS paper)
  paperWidth = signal(600);
  paperHeight = signal(700);

  // --- Gestor Documental (DMS) ---
  policyDocuments = signal<DbDocument[]>([]);
  selectedNodePermissions = signal<Record<string, PermissionLevel>>({});
  showDocumentsModal = signal(false);
  newDocName = '';
  newDocFile: File | null = null;
  uploadingDoc = signal(false);

  // Expose constants to template
  readonly colWidth = COL_WIDTH;
  readonly headerH = HEADER_H;

  private nodeMap = new Map<string, {
    id: string; label: string; type: NodeType;
    x: number; y: number;
    departmentId: string; userId?: string; userEmail?: string;
    formFields?: any[];
  }>();
  private edgeMap = new Map<string, {
    id: string; source: string; target: string;
    label?: string; edgeType: string;
  }>();

  // ── UI state ──────────────────────────────────────────────────
  selectedNodeId = signal<string | null>(null);
  selectedNodeData = signal<any>(null);
  selectedNodeEmail = signal('');
  resolvingEmail = signal(false);
  emailError = signal<string | null>(null);
  showAddSwimlane = signal(false);
  showAddCollaborator = signal(false);
  activePlacementType = signal<NodeType | null>(null);
  connectionMode = signal(false);

  // ── Form values ───────────────────────────────────────────────
  newNodeLabel = '';
  newNodeSwimlane = '';
  newNodeUser = '';
  newSwimlaneName = '';
  newCollaboratorEmail = '';

  // ── Form Designer ─────────────────────────────────────────────
  showFormDesigner = signal(false);
  formElements = signal<any[]>([]);
  selectedFormElementId = signal<string | null>(null);

  activeDragFormElementId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private elementStartX = 0;
  private elementStartY = 0;

  selectedFormElement = computed(() => {
    const id = this.selectedFormElementId();
    if (!id) return null;
    return this.formElements().find(el => el.id === id) || null;
  });

  // ── IA Chat ───────────────────────────────────────────────────
  showIaPanel = signal(false);
  iaQuestion = signal('');
  isListeningIa = signal(false);
  isProcessingIa = signal(false);
  chatMessages = signal<{ role: 'user' | 'agent'; text: string }[]>([]);
  private recognition: any;

  // ── JointJS ───────────────────────────────────────────────────
  private jGraph!: joint.dia.Graph;
  private jPaper!: joint.dia.Paper;
  private canvasReady = false;
  private isParsing = false;
  private pendingDiagram: Record<string, unknown> | null = null;

  readonly palette = NODE_PALETTE;

  // ─────────────────────────────────────────────────────────────
  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.policyId.set(id);
      this.loadPolicy(id);
    }
    this.initSpeechRecognition();
    this.loadAnalyticsData();
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initJoint());
  }

  ngOnDestroy(): void {
    this.wsSvc.disconnect();
    this.jPaper?.remove();
  }

  // ─────────────────────────────────────────────────────────────
  // JointJS init (transparent — swimlanes rendered as HTML behind)
  // ─────────────────────────────────────────────────────────────
  private initJoint(): void {
    this.jGraph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });

    this.jPaper = new joint.dia.Paper({
      el: this.canvasRef.nativeElement,
      model: this.jGraph,
      width: this.paperWidth(),
      height: this.paperHeight(),
      gridSize: 10,
      drawGrid: {
        name: 'doubleMesh',
        args: [
          { color: '#f1f5f9', thickness: 1 },
          { color: '#e2e8f0', scale: 5, thickness: 1 }
        ]
      },
      background: { color: 'transparent' },
      cellViewNamespace: joint.shapes,
      interactive: (cellView) => {
        if (this.connectionMode()) {
          return { elementMove: false };
        }
        return true;
      },
      defaultLink: () => this.makeLink('', ''),
      defaultConnectionPoint: { name: 'boundary' },
      defaultAnchor: { name: 'center' },
      defaultRouter: { name: 'manhattan' },
      defaultConnector: { name: 'rounded', args: { radius: 8 } },
      magnetThreshold: 'onleave',
      validateConnection: (sv, sm, tv, tm) => {
        return sv.model.id !== tv.model.id;
      },
      validateMagnet: (cellView, magnet) => {
        return magnet.getAttribute('magnet') === 'true';
      },
      snapLinks: { radius: 20 },
      linkPinning: false,
    });

    this.jPaper.on('element:pointerclick', (view) => {
      this.jPaper.hideTools();
      this.zone.run(() => this.selectNode(view.model.id as string));
    });

    this.jPaper.on('blank:pointerclick', (evt, x, y) => {
      this.jPaper.hideTools();
      const placementType = this.activePlacementType();
      if (placementType) {
        this.zone.run(() => {
          this.placeNodeAt(placementType, x, y);
          this.activePlacementType.set(null);
        });
      } else {
        this.zone.run(() => this.selectedNodeId.set(null));
      }
    });

    this.jPaper.on('element:pointermove', (view) => {
      const { x, y } = view.model.position();
      const data = this.nodeMap.get(view.model.id as string);
      if (data) {
        data.x = x;
        data.y = y;

        // Auto-assign swimlane based on x coordinate
        const sls = this.swimlanes();
        if (sls.length > 0) {
          const slIdx = Math.max(0, Math.min(sls.length - 1, Math.floor(x / COL_WIDTH)));
          const targetSlId = sls[slIdx].id;
          if (data.departmentId !== targetSlId) {
            data.departmentId = targetSlId;
            if (this.selectedNodeId() === data.id) {
              this.zone.run(() => {
                this.selectedNodeData.set({ ...data });
              });
            }
          }
        }
      }
    });

    this.jPaper.on('element:pointerup', () => {
      this.zone.run(() => this.broadcastUpdate());
    });

    this.jPaper.on('element:pointerdblclick', (view) => {
      this.zone.run(() => {
        this.selectNode(view.model.id as string);
        setTimeout(() => {
          const input = document.querySelector('.designer__right input') as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 50);
      });
    });

    this.jPaper.on('link:pointerclick', (linkView) => {
      this.jPaper.hideTools();
      const tools = new joint.dia.ToolsView({
        tools: [
          new joint.linkTools.Remove()
        ]
      });
      linkView.addTools(tools);
    });

    // Graph events for link connections and removal
    this.jGraph.on('add', (cell) => {
      if (this.isParsing) return;
      if (cell.isLink()) {
        cell.on('change:target', (link: any) => {
          if (this.isParsing) return;
          const source = link.source();
          const target = link.target();
          if (source.id && target.id) {


            const existing = this.edgeMap.get(link.id as string);
            if (!existing || existing.source !== source.id || existing.target !== target.id) {
              this.zone.run(() => {
                this.edgeMap.set(link.id as string, {
                  id: link.id as string,
                  source: source.id as string,
                  target: target.id as string,
                  edgeType: link.get('edgeType') || 'sequential',
                  label: link.label(0)?.attrs?.text?.text || ''
                });
                this.broadcastUpdate();
              });
            }
          }
        });
      }
    });

    this.jGraph.on('remove', (cell) => {
      if (this.isParsing) return;
      if (cell.isLink()) {
        const id = cell.id as string;
        if (this.edgeMap.has(id)) {
          this.zone.run(() => {
            this.edgeMap.delete(id);
            this.broadcastUpdate();
          });
        }
      }
    });

    this.canvasReady = true;
    this.syncPaperSize();

    if (this.pendingDiagram) {
      this.parseDiagram(this.pendingDiagram);
      this.pendingDiagram = null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Sync paper dimensions → HTML layer + JointJS paper
  // ─────────────────────────────────────────────────────────────
  private syncPaperSize(): void {
    const totalW = 3000;
    const totalH = 3000;
    this.zone.run(() => {
      this.paperWidth.set(totalW);
      this.paperHeight.set(totalH);
    });
    if (this.canvasReady) {
      this.jPaper.setDimensions(totalW, totalH);
    }
  }

  private getMaxRowCount(): number {
    const counts = new Map<string, number>();
    for (const n of this.nodeMap.values()) {
      counts.set(n.departmentId, (counts.get(n.departmentId) || 0) + 1);
    }
    return Math.max(0, ...counts.values());
  }

  // ─────────────────────────────────────────────────────────────
  // Link factory (arrows native to JointJS — no SVG marker issues)
  // ─────────────────────────────────────────────────────────────
  private makeLink(srcId: string, tgtId: string, label = '', edgeType = 'sequential'): joint.shapes.standard.Link {
    const link = new joint.shapes.standard.Link({
      source: srcId ? { id: srcId } : {},
      target: tgtId ? { id: tgtId } : {},
      attrs: {
        line: {
          stroke: '#374151',
          strokeWidth: 1.5,
          targetMarker: { type: 'path', d: 'M 8 -4 L 0 0 L 8 4 Z', fill: '#374151' },
        },
      },
      labels: label ? [{ attrs: { text: { text: label, fontSize: 10, fill: '#374151' } } }] : [],
      router: { name: 'manhattan' },
      connector: { name: 'rounded', args: { radius: 8 } },
    });
    link.set('edgeType', edgeType);
    return link;
  }

  // ─────────────────────────────────────────────────────────────
  // Add a JointJS node element
  // ─────────────────────────────────────────────────────────────
  private addJointNode(id: string, label: string, type: NodeType, x: number, y: number): joint.dia.Element {
    const { w, h } = NODE_SIZE[type];
    const color = this.palette.find(p => p.type === type)?.color ?? '#5b6ef0';
    let el: joint.dia.Element;

    switch (type) {
      case 'start':
        el = new joint.shapes.standard.Circle({
          id, position: { x, y }, size: { width: w, height: h },
          attrs: {
            body: { fill: '#1f2937', stroke: 'none' },
            label: { text: '', pointerEvents: 'none' }
          },
          z: 2,
        });
        break;

      case 'end':
        el = new joint.shapes.standard.Circle({
          id, position: { x, y }, size: { width: w, height: h },
          attrs: {
            body: { fill: '#fff', stroke: '#1f2937', strokeWidth: 4 },
            label: { text: '', pointerEvents: 'none' },
          },
          z: 2,
        });
        // inner filled dot via second circle
        {
          const inner = new joint.shapes.standard.Circle({
            id: `${id}-inner`,
            position: { x: x + 8, y: y + 8 },
            size: { width: w - 16, height: h - 16 },
            attrs: { body: { fill: '#1f2937', stroke: 'none', pointerEvents: 'none' }, label: { text: '', pointerEvents: 'none' } },
            z: 3,
          });
          this.jGraph.addCell(inner);
          el.embed(inner);
        }
        break;

      case 'decision':
        el = new joint.shapes.standard.Path({
          id, position: { x, y }, size: { width: w, height: h },
          attrs: {
            body: {
              fill: '#fff', stroke: '#1f2937', strokeWidth: 1.5,
              d: `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`,
            },
            label: { text: label, fontSize: 10, fill: '#1f2937', textWrap: { width: w - 8, height: h - 8 }, pointerEvents: 'none' },
          },
          z: 2,
        });
        break;

      case 'fork':
      case 'join':
        el = new joint.shapes.standard.Rectangle({
          id, position: { x, y }, size: { width: w, height: h },
          attrs: {
            body: { fill: '#1f2937', stroke: '#1f2937', rx: 2, ry: 2 },
            label: { text: label, fontSize: 9, fill: '#fff', refY: -14, pointerEvents: 'none' },
          },
          z: 2,
        });
        break;

      default: // task
        el = new joint.shapes.standard.Rectangle({
          id, position: { x, y }, size: { width: w, height: h },
          attrs: {
            body: { fill: '#fff', stroke: '#1f2937', strokeWidth: 1.5, rx: 8, ry: 8 },
            label: {
              text: label, fontSize: 12, fill: '#1f2937',
              textWrap: { width: w - 16, height: h - 8 },
              pointerEvents: 'none'
            },
          },
          z: 2,
        });
    }

    el.attr('body/magnet', this.connectionMode());
    this.jGraph.addCell(el);
    return el;
  }

  get graphNodesList() {
    return [...this.nodeMap.values()];
  }

  // ─────────────────────────────────────────────────────────────
  // Policy load / parse
  // ─────────────────────────────────────────────────────────────
  loadPolicy(id: string): void {
    this.loading.set(true);
    this.policySvc.getById(id).subscribe({
      next: (p) => {
        this.policyName.set(p.name);
        this.policyDesc.set(p.description);
        this.collaborators.set(p.collaborators || []);
        this.parseDiagram(p.diagram ?? {});
        this.loading.set(false);
        this.loadDocuments(id);
        this.wsSvc.connect(() => {
          this.wsSvc.subscribe(`/topic/policy/${id}`, (msg) => {
            if (msg) this.parseDiagram(msg);
          });
        });
      },
      error: () => this.loading.set(false)
    });
  }

  parseDiagram(diagram: Record<string, unknown>): void {
    if (!this.canvasReady) {
      this.pendingDiagram = diagram;
      return;
    }

    this.isParsing = true;
    try {
      this.jGraph.clear();
      this.nodeMap.clear();
      this.edgeMap.clear();

      const rawSwimlanes = (diagram['swimlanes'] as DiagramSwimlane[]) ?? [];
      const rawNodes = (diagram['nodes'] as any[]) ?? [];
      const rawEdges = (diagram['edges'] as any[]) ?? [];

      this.swimlanes.set(rawSwimlanes);
      this.syncPaperSize();

      rawNodes.forEach(n => {
        const type: NodeType = n.data?.type ?? 'task';
        const label: string = n.data?.label ?? n.id;
        const slId: string = n.data?.departmentId ?? rawSwimlanes[0]?.id ?? '';
        const slIdx = Math.max(0, rawSwimlanes.findIndex((s: any) => s.id === slId));
        const { w } = NODE_SIZE[type];
        const x: number = n.data?.x ?? (slIdx * COL_WIDTH + (COL_WIDTH - w) / 2);
        const y: number = n.data?.y ?? (HEADER_H + START_Y + this.nodeMap.size * ROW_SPACING);

        this.nodeMap.set(n.id, {
          id: n.id,
          label,
          type,
          x,
          y,
          departmentId: slId,
          userId: n.data?.userId,
          userEmail: n.data?.userEmail,
          formFields: Array.isArray(n.data?.formFields) ? n.data.formFields : []
        });
        this.addJointNode(n.id, label, type, x, y);
      });

      rawEdges.forEach(e => {
        this.edgeMap.set(e.id, { id: e.id, source: e.source, target: e.target, label: e.label ?? '', edgeType: e.type ?? 'sequential' });
        const link = this.makeLink(e.source, e.target, e.label ?? '', e.type ?? 'sequential');
        link.id = e.id;
        this.jGraph.addCell(link);
      });
    } finally {
      this.isParsing = false;
    }
    this.calculateBestRouteSuggestion();
  }

  // ─────────────────────────────────────────────────────────────
  // WebSocket broadcast
  // ─────────────────────────────────────────────────────────────
  broadcastUpdate(): void {
    if (this.isParsing) return;
    const id = this.policyId();
    if (!id) return;
    this.wsSvc.publish(`/app/policy/${id}/update`, this.buildDiagramPayload());
    this.calculateBestRouteSuggestion();
  }

  private buildDiagramPayload(): Record<string, unknown> {
    return {
      swimlanes: this.swimlanes(),
      nodes: [...this.nodeMap.values()].map(n => ({
        id: n.id, data: {
          label: n.label,
          type: n.type,
          departmentId: n.departmentId,
          userId: n.userId ?? '',
          userEmail: n.userEmail ?? '',
          x: n.x,
          y: n.y,
          formFields: n.formFields ?? []
        }
      })),
      edges: [...this.edgeMap.values()].map(e => ({
        id: e.id, source: e.source, target: e.target, label: e.label ?? '', type: e.edgeType
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Swimlanes
  // ─────────────────────────────────────────────────────────────
  private addDefaultSwimlane(): void { this.doAddSwimlane('Departamento A'); }

  openAddSwimlane(): void { this.newSwimlaneName = ''; this.showAddSwimlane.set(true); }

  confirmAddSwimlane(): void {
    if (!this.newSwimlaneName.trim()) return;
    this.doAddSwimlane(this.newSwimlaneName.trim());
    this.showAddSwimlane.set(false);
    this.broadcastUpdate();
  }

  private doAddSwimlane(name: string): void {
    const id = `sl-${Date.now()}`;
    const color = COLORS[this.swimlanes().length % COLORS.length];
    this.swimlanes.update(l => [...l, { id, label: name, color }]);
    this.syncPaperSize();
  }

  deleteSwimlane(id: string): void {
    this.swimlanes.update(l => l.filter(s => s.id !== id));
    this.syncPaperSize();
    this.broadcastUpdate();
  }

  // ─────────────────────────────────────────────────────────────
  // Collaborators
  // ─────────────────────────────────────────────────────────────
  openAddCollaborator(): void { this.newCollaboratorEmail = ''; this.emailError.set(null); this.showAddCollaborator.set(true); }

  confirmAddCollaborator(): void {
    const email = this.newCollaboratorEmail.trim();
    if (!email) return;
    this.resolvingEmail.set(true);
    this.emailError.set(null);
    this.userSvc.getByEmail(email).subscribe({
      next: (user) => {
        this.resolvingEmail.set(false);
        if (this.collaborators().includes(user.id)) { this.emailError.set('Este usuario ya es colaborador.'); return; }
        const pid = this.policyId();
        if (pid) {
          this.policySvc.addCollaborator(pid, user.id).subscribe({
            next: () => { this.collaborators.update(c => [...c, user.id]); this.showAddCollaborator.set(false); },
            error: () => this.emailError.set('Error al guardar el colaborador.')
          });
        } else {
          this.collaborators.update(c => [...c, user.id]);
          this.showAddCollaborator.set(false);
        }
      },
      error: () => { this.resolvingEmail.set(false); this.emailError.set(`No se encontró un usuario con el email "${email}"`); }
    });
  }

  removeCollaborator(userId: string): void {
    const pid = this.policyId();
    if (pid) this.policySvc.removeCollaborator(pid, userId).subscribe({ next: () => this.collaborators.update(c => c.filter(id => id !== userId)) });
    else this.collaborators.update(c => c.filter(id => id !== userId));
  }

  // ─────────────────────────────────────────────────────────────
  // Nodes
  // ─────────────────────────────────────────────────────────────
  selectPaletteItem(type: NodeType): void {
    if (this.activePlacementType() === type) {
      this.activePlacementType.set(null);
    } else {
      this.activePlacementType.set(type);
    }
  }

  placeNodeAt(type: NodeType, x: number, y: number): void {
    const id = `n-${Date.now()}`;
    const typeLabel = this.getPaletteLabel(type);
    const existingCount = [...this.nodeMap.values()].filter(n => n.type === type).length;
    const label = type === 'start' ? 'Inicio' : type === 'end' ? 'Fin' : `${typeLabel} ${existingCount + 1}`;

    const sls = this.swimlanes();
    let slId = '';
    if (sls.length > 0) {
      const slIdx = Math.max(0, Math.min(sls.length - 1, Math.floor(x / COL_WIDTH)));
      slId = sls[slIdx].id;
    }

    const { w, h } = NODE_SIZE[type];
    const nodeX = x - w / 2;
    const nodeY = y - h / 2;

    this.nodeMap.set(id, {
      id,
      label,
      type,
      x: nodeX,
      y: nodeY,
      departmentId: slId,
      userId: '',
      formFields: []
    });

    this.syncPaperSize();
    if (this.canvasReady) {
      this.addJointNode(id, label, type, nodeX, nodeY);
    }

    this.selectNode(id);
    setTimeout(() => this.broadcastUpdate(), 50);
  }

  toggleConnectionMode(): void {
    const nextMode = !this.connectionMode();
    this.connectionMode.set(nextMode);

    if (this.canvasReady) {
      this.jGraph.getElements().forEach(el => {
        if (!el.id.toString().endsWith('-inner')) {
          el.attr('body/magnet', nextMode);
        }
      });
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.connectionMode()) {
      if (this.canvasReady) {
        // Eliminar links incompletos (sin target definido)
        this.jGraph.getLinks().forEach(link => {
          if (!link.getTargetElement()) {
            link.remove();
          }
        });

        // Desactivar magnet en todos los nodos
        this.jGraph.getElements().forEach(el => {
          if (!el.id.toString().endsWith('-inner')) {
            el.attr('body/magnet', false);
          }
        });
      }
      this.connectionMode.set(false);
    }
  }

  selectNode(nodeId: string): void {
    const data = this.nodeMap.get(nodeId);
    if (!data) return;
    this.selectedNodeId.set(nodeId);
    this.selectedNodeData.set({ ...data });
    this.selectedNodeEmail.set(data.userEmail ?? '');
    this.emailError.set(null);
    if (data.type === 'task') {
      this.loadNodePermissions(nodeId);
    }
  }

  setSelectedProp(prop: string, value: string): void {
    const d = this.selectedNodeData();
    if (!d) return;
    this.selectedNodeData.set({ ...d, [prop]: value });
    this.updateNode();
  }

  resolveEmailAndUpdate(): void {
    const d = this.selectedNodeData();
    if (!d) return;
    const email = this.selectedNodeEmail().trim();
    if (!email) { this.selectedNodeData.set({ ...d, userId: '', userEmail: '' }); this.updateNode(); return; }
    this.resolvingEmail.set(true);
    this.emailError.set(null);
    this.userSvc.getByEmail(email).subscribe({
      next: (user) => { this.resolvingEmail.set(false); this.selectedNodeData.set({ ...d, userId: user.id, userEmail: email }); this.updateNode(); },
      error: () => { this.resolvingEmail.set(false); this.emailError.set(`No se encontró un usuario con el email "${email}"`); }
    });
  }

  updateNode(): void {
    const d = this.selectedNodeData();
    if (!d) return;
    const existing = this.nodeMap.get(d.id);
    if (!existing) return;

    // Check if the swimlane changed
    if (existing.departmentId !== d.departmentId) {
      const sls = this.swimlanes();
      const slIdx = sls.findIndex(s => s.id === d.departmentId);
      if (slIdx !== -1) {
        const { w } = NODE_SIZE[d.type as NodeType];
        const newX = slIdx * COL_WIDTH + (COL_WIDTH - w) / 2;
        d.x = newX;

        const el = this.jGraph.getCell(d.id) as joint.dia.Element;
        if (el) {
          el.position(newX, d.y);
          if (d.type === 'end') {
            const inner = this.jGraph.getCell(`${d.id}-inner`) as joint.dia.Element;
            if (inner) inner.position(newX + 8, d.y + 8);
          }
        }
      }
    }

    this.nodeMap.set(d.id, { ...existing, ...d });
    const el = this.jGraph.getCell(d.id) as joint.dia.Element;
    if (el) el.attr('label/text', d.label);
    this.broadcastUpdate();
  }

  deleteNode(): void {
    const id = this.selectedNodeId();
    if (!id) return;
    this.nodeMap.delete(id);
    for (const [eid, e] of this.edgeMap.entries()) {
      if (e.source === id || e.target === id) this.edgeMap.delete(eid);
    }
    const cell = this.jGraph.getCell(id);
    if (cell) cell.remove();
    const innerCell = this.jGraph.getCell(`${id}-inner`);
    if (innerCell) innerCell.remove();
    this.selectedNodeId.set(null);
    this.selectedNodeData.set(null);
    this.syncPaperSize();
    this.broadcastUpdate();
  }



  // ─────────────────────────────────────────────────────────────
  // Save
  // ─────────────────────────────────────────────────────────────
  save(): void {
    this.saving.set(true);
    const req: PolicyRequest = {
      name: this.policyName(), description: this.policyDesc(),
      diagram: this.buildDiagramPayload(), status: 'DRAFT',
      collaborators: this.collaborators()
    };
    const id = this.policyId();
    const obs = id ? this.policySvc.update(id, req) : this.policySvc.create(req);
    obs.subscribe({
      next: (p) => {
        if (!id) { this.policyId.set(p.id); this.router.navigate(['/admin/designer', p.id], { replaceUrl: true }); }
        this.saving.set(false);
      },
      error: () => this.saving.set(false)
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  get canSave(): boolean { return !!this.policyName().trim() && !this.saving(); }

  nodeColor(type: string): string { return this.palette.find(p => p.type === type)?.color ?? '#5b6ef0'; }
  nodeIcon(type: string): string { return this.palette.find(p => p.type === type)?.icon ?? '□'; }
  getPaletteLabel(type: NodeType): string { return this.palette.find(p => p.type === type)?.label ?? type; }
  swimlaneColor(id: string): string { return this.swimlanes().find(s => s.id === id)?.color ?? '#5b6ef0'; }
  trackById(_: number, x: { id: string }): string { return x.id; }



  // ─────────────────────────────────────────────────────────────
  // IA Chat
  // ─────────────────────────────────────────────────────────────
  toggleIaPanel(): void { this.showIaPanel.set(!this.showIaPanel()); }

  private initSpeechRecognition(): void {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    this.recognition = new SR();
    this.recognition.lang = 'es-ES';
    this.recognition.interimResults = false;
    this.recognition.onresult = (e: any) => { const t = e.results[0][0].transcript; this.iaQuestion.update(v => v ? v + ' ' + t : t); };
    this.recognition.onerror = () => this.isListeningIa.set(false);
    this.recognition.onend = () => this.isListeningIa.set(false);
  }

  toggleIaVoice(): void {
    if (!this.recognition) return;
    if (this.isListeningIa()) { this.recognition.stop(); this.isListeningIa.set(false); }
    else { this.recognition.start(); this.isListeningIa.set(true); }
  }

  sendIaMessage(): void {
    const q = this.iaQuestion().trim();
    if (!q || this.isProcessingIa()) return;
    this.chatMessages.update(m => [...m, { role: 'user', text: q }]);
    this.iaQuestion.set('');
    this.isProcessingIa.set(true);
    this.iaSvc.designerAgent(q).subscribe({
      next: (res) => { this.chatMessages.update(m => [...m, { role: 'agent', text: res?.response ?? 'Sin respuesta.' }]); this.isProcessingIa.set(false); setTimeout(() => this.scrollChatToBottom(), 50); },
      error: (err) => { const msg = typeof err.error === 'string' ? err.error : 'Error al conectar con el agente.'; this.chatMessages.update(m => [...m, { role: 'agent', text: `⚠️ ${msg}` }]); this.isProcessingIa.set(false); setTimeout(() => this.scrollChatToBottom(), 50); }
    });
  }

  sendDesignFlow(): void {
    const q = this.iaQuestion().trim();
    if (!q || this.isProcessingIa()) return;
    this.chatMessages.update(m => [...m, { role: 'user', text: `✨ ${q}` }]);
    this.iaQuestion.set('');
    this.isProcessingIa.set(true);
    this.iaSvc.designFlow({ diagram: this.buildDiagramPayload(), instruction: q }).subscribe({
      next: (res) => {
        if (res?.diagram) {
          try { const d = typeof res.diagram === 'string' ? JSON.parse(res.diagram) : res.diagram; this.parseDiagram(d); setTimeout(() => this.broadcastUpdate(), 100); this.chatMessages.update(m => [...m, { role: 'agent', text: '✅ Diagrama actualizado.' }]); }
          catch { this.chatMessages.update(m => [...m, { role: 'agent', text: '⚠️ No pude interpretar el diagrama.' }]); }
        } else { this.chatMessages.update(m => [...m, { role: 'agent', text: '⚠️ Sin respuesta válida.' }]); }
        this.isProcessingIa.set(false);
        setTimeout(() => this.scrollChatToBottom(), 50);
      },
      error: (err) => { const msg = typeof err.error === 'string' ? err.error : 'Error al aplicar el cambio.'; this.chatMessages.update(m => [...m, { role: 'agent', text: `⚠️ ${msg}` }]); this.isProcessingIa.set(false); setTimeout(() => this.scrollChatToBottom(), 50); }
    });
  }

  onIaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.sendIaMessage(); }
  }

  private scrollChatToBottom(): void {
    const el = document.querySelector('.ia-chat__messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Form Designer Methods ─────────────────────────────────────
  openFormDesigner(): void {
    const nodeId = this.selectedNodeId();
    if (!nodeId) return;
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    // Copy the existing form fields or default to empty array safely
    const fields = Array.isArray(node.formFields) ? JSON.parse(JSON.stringify(node.formFields)) : [];
    this.formElements.set(fields);
    this.selectedFormElementId.set(null);
    this.showFormDesigner.set(true);
  }

  addFormElement(type: 'label' | 'input'): void {
    const id = `fe-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const text = type === 'label' ? 'Escribe aquí tu mensaje' : 'Escribe tu respuesta aquí';

    // Find an empty Y slot
    const x = 50;
    const y = 50 + (this.formElements().length * 40) % 250;

    const newElement = {
      id,
      type,
      x,
      y,
      text
    };

    console.log('addFormElement adding:', newElement);
    this.formElements.set([...this.formElements(), newElement]);
    this.selectedFormElementId.set(id);
    console.log('formElements is now:', this.formElements());
  }

  selectFormElement(id: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedFormElementId.set(id);
  }

  startDragFormElement(event: MouseEvent, elementId: string, currentX: number, currentY: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedFormElementId.set(elementId);
    this.activeDragFormElementId = elementId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.elementStartX = currentX;
    this.elementStartY = currentY;
  }

  updateFormElementText(text: string): void {
    const id = this.selectedFormElementId();
    if (!id) return;
    this.formElements.set(
      this.formElements().map(el => el.id === id ? { ...el, text } : el)
    );
  }

  deleteFormElement(id: string): void {
    console.log('deleteFormElement called for:', id);
    this.formElements.set(this.formElements().filter(el => el.id !== id));
    if (this.selectedFormElementId() === id) {
      this.selectedFormElementId.set(null);
    }
  }

  saveFormDesign(): void {
    const nodeId = this.selectedNodeId();
    if (!nodeId) return;
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    node.formFields = this.formElements();
    this.showFormDesigner.set(false);
    this.broadcastUpdate();
  }

  @HostListener('document:mousemove', ['$event'])
  onFormMouseMove(event: MouseEvent): void {
    if (this.activeDragFormElementId) {
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;

      let newX = this.elementStartX + deltaX;
      let newY = this.elementStartY + deltaY;

      // Snap to 10px grid and clamp within 600x400 canvas bounds
      newX = Math.max(0, Math.min(420, Math.round(newX / 10) * 10));
      newY = Math.max(0, Math.min(350, Math.round(newY / 10) * 10));

      this.formElements.set(
        this.formElements().map(el => el.id === this.activeDragFormElementId ? { ...el, x: newX, y: newY } : el)
      );
    }
  }

  @HostListener('document:mouseup')
  onFormMouseUp(): void {
    if (this.activeDragFormElementId) {
      this.activeDragFormElementId = null;
    }
  }

  // --- Gestor Documental (DMS) Métodos ---
  loadDocuments(policyId: string): void {
    this.docSvc.getDocumentsByPolicy(policyId).subscribe({
      next: (docs) => {
        this.policyDocuments.set(docs);
        const nodeId = this.selectedNodeId();
        if (nodeId && this.selectedNodeData()?.type === 'task') {
          this.loadNodePermissions(nodeId);
        }
      },
      error: (err) => console.error('Error loading documents for policy:', err)
    });
  }

  openDocumentsModal(): void {
    const pid = this.policyId();
    if (!pid) return;
    this.showDocumentsModal.set(true);
    this.loadDocuments(pid);
  }

  closeDocumentsModal(): void {
    this.showDocumentsModal.set(false);
    this.newDocName = '';
    this.newDocFile = null;
  }

  onFileSelected(event: any): void {
    const file = event.target.files?.[0];
    if (file) {
      this.newDocFile = file;
      if (!this.newDocName.trim()) {
        const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        this.newDocName = nameWithoutExt;
      }
    }
  }

  uploadDocument(): void {
    const pid = this.policyId();
    if (!pid || !this.newDocName.trim() || !this.newDocFile) return;

    this.uploadingDoc.set(true);
    this.docSvc.createDocument(pid, this.newDocName.trim(), this.newDocFile).subscribe({
      next: () => {
        this.uploadingDoc.set(false);
        this.newDocName = '';
        this.newDocFile = null;
        this.loadDocuments(pid);
        alert('Documento subido con éxito.');
      },
      error: (err) => {
        console.error('Error uploading document:', err);
        this.uploadingDoc.set(false);
        alert('Error al subir el documento.');
      }
    });
  }

  deleteDocument(docId: string): void {
    const pid = this.policyId();
    if (!pid || !confirm('¿Estás seguro de eliminar este documento? Se borrarán todos sus permisos asociados.')) return;

    this.docSvc.deleteDocument(docId).subscribe({
      next: () => {
        this.loadDocuments(pid);
      },
      error: (err) => {
        console.error('Error deleting document:', err);
        alert('Error al eliminar el documento.');
      }
    });
  }

  loadNodePermissions(nodeId: string): void {
    const docs = this.policyDocuments();
    const perms: Record<string, PermissionLevel> = {};
    docs.forEach(doc => {
      perms[doc.id] = 'NONE';
    });
    this.selectedNodePermissions.set(perms);

    docs.forEach(doc => {
      this.docSvc.getDocumentPermissions(doc.id).subscribe({
        next: (permissions) => {
          const match = permissions.find(p => p.nodeId === nodeId);
          if (match) {
            this.selectedNodePermissions.update(p => ({
              ...p,
              [doc.id]: match.permissionLevel
            }));
          }
        },
        error: (err) => console.error('Error fetching doc permissions:', err)
      });
    });
  }

  changePermission(docId: string, level: PermissionLevel): void {
    const nodeId = this.selectedNodeId();
    if (!nodeId) return;

    this.docSvc.updatePermission(docId, nodeId, level).subscribe({
      next: () => {
        this.selectedNodePermissions.update(p => ({
          ...p,
          [docId]: level
        }));
      },
      error: (err) => {
        console.error('Error updating permission:', err);
        alert('Error al actualizar el permiso del documento.');
      }
    });
  }

  // --- Deep Learning Predictions ---

  loadAnalyticsData(): void {
    this.analyticsSvc.getAnalytics().subscribe({
      next: (res) => {
        if (res && res.avgTimeByNode) {
          Object.entries(res.avgTimeByNode).forEach(([key, val]) => {
            this.nodeAvgTimesMap.set(key, Number(val));
          });
        }
      },
      error: (err) => console.error('Error loading analytics for designer:', err)
    });
  }

  traceRoute(startNodeId: string): any[] {
    const routeNodes: any[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = startNodeId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = this.nodeMap.get(currentId);
      if (!node) break;

      // Stop if we reach a join or end node
      if (node.type === 'join' || node.type === 'end') {
        break;
      }

      routeNodes.push(node);

      // Find outgoing edges
      const outgoing = [...this.edgeMap.values()].filter(e => e.source === currentId);
      if (outgoing.length === 0) {
        break;
      }

      // Pick the first target (or follow sequential path)
      currentId = outgoing[0].target;
    }

    return routeNodes;
  }

  calculateBestRouteSuggestion(): void {
    const forkNode = [...this.nodeMap.values()].find(n => n.type === 'fork');
    if (!forkNode) {
      this.bestRouteSuggestion.set(null);
      return;
    }

    const outgoingEdges = [...this.edgeMap.values()].filter(e => e.source === forkNode.id);
    if (outgoingEdges.length < 2) {
      this.bestRouteSuggestion.set(null);
      return;
    }

    // Trace both branches
    const branchAStart = outgoingEdges[0].target;
    const branchBStart = outgoingEdges[1].target;

    const routeANodes = this.traceRoute(branchAStart);
    const routeBNodes = this.traceRoute(branchBStart);

    const tasksA = routeANodes.filter(n => n.type === 'task');
    const tasksB = routeBNodes.filter(n => n.type === 'task');

    const routeANodesCount = tasksA.length;
    const routeBNodesCount = tasksB.length;

    // Calculate average node times (lookup from analytics or default 60.0)
    let routeATimeSum = 0;
    tasksA.forEach(t => {
      routeATimeSum += this.nodeAvgTimesMap.get(t.label) ?? 60.0;
    });
    const routeAAvgTime = routeANodesCount > 0 ? (routeATimeSum / routeANodesCount) : 60.0;

    let routeBTimeSum = 0;
    tasksB.forEach(t => {
      routeBTimeSum += this.nodeAvgTimesMap.get(t.label) ?? 60.0;
    });
    const routeBAvgTime = routeBNodesCount > 0 ? (routeBTimeSum / routeBNodesCount) : 60.0;

    this.predictionSvc.predictBestRoute({
      route_a_avg_time: routeAAvgTime,
      route_b_avg_time: routeBAvgTime,
      route_a_load: 0.5,
      route_b_load: 0.5,
      route_a_nodes: routeANodesCount,
      route_b_nodes: routeBNodesCount
    }).subscribe({
      next: (res) => {
        this.bestRouteSuggestion.set(res);
      },
      error: (err) => {
        console.error('Error predicting best route:', err);
        this.bestRouteSuggestion.set(null);
      }
    });
  }
}
