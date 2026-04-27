import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import type { Node, Edge, ClusterNode } from '@swimlane/ngx-graph';
import { Subject } from 'rxjs';
import { PolicyService } from '../../core/services/policy.service';
import { PolicyRequest } from '../../core/models';
import { UserService } from '../../core/services/user.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { IaService } from '../../core/services/ia.service';

export type NodeType = 'start' | 'end' | 'task' | 'decision' | 'fork' | 'join';

export interface DiagramSwimlane {
  id: string;
  label: string;
  color: string;
}

export const NODE_PALETTE = [
  { type: 'start'    as NodeType, label: 'Inicio',    icon: '▶', color: '#10d9a0' },
  { type: 'task'     as NodeType, label: 'Tarea',     icon: '☐', color: '#5b6ef0' },
  { type: 'decision' as NodeType, label: 'Decisión',  icon: '◇', color: '#f59e0b' },
  { type: 'fork'     as NodeType, label: 'Fork',      icon: '⑂', color: '#8b5cf6' },
  { type: 'join'     as NodeType, label: 'Join',      icon: '⑁', color: '#8b5cf6' },
  { type: 'end'      as NodeType, label: 'Fin',       icon: '■', color: '#ef4444' },
];

const COLORS = ['#5b6ef0','#10d9a0','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

@Component({
  selector: 'app-designer',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, RouterLink, NgxGraphModule],
  templateUrl: './designer.component.html',
  styleUrl: './designer.component.scss'
})
export class DesignerComponent implements OnInit, OnDestroy {
  private route   = inject(ActivatedRoute);
  private router  = inject(Router);
  private policySvc = inject(PolicyService);
  private userSvc   = inject(UserService);
  private wsSvc     = inject(WebsocketService);
  private iaSvc     = inject(IaService);

  // ── Policy meta ─────────────────────────────────────────────
  policyId    = signal<string | null>(null);
  policyName  = signal('Nueva Política');
  policyDesc  = signal('');
  loading     = signal(false);
  saving      = signal(false);

  // ── Graph data ───────────────────────────────────────────────
  graphNodes  = signal<Node[]>([]);
  graphLinks  = signal<Edge[]>([]);
  clusters    = signal<ClusterNode[]>([]);
  swimlanes   = signal<DiagramSwimlane[]>([]);
  collaborators = signal<string[]>([]);

  // ── UI state ─────────────────────────────────────────────────
  selectedNode        = signal<Node | null>(null);
  selectedNodeEmail   = signal('');
  resolvingEmail      = signal(false);
  emailError          = signal<string | null>(null);
  showAddNode         = signal(false);
  showAddEdge         = signal(false);
  showAddSwimlane     = signal(false);
  showAddCollaborator = signal(false);
  addingNodeType      = signal<NodeType>('task');

  // ── Form values ──────────────────────────────────────────────
  newNodeLabel    = '';
  newNodeSwimlane = '';
  newNodeUser     = '';
  newSwimlaneName = '';
  newCollaboratorEmail = '';
  edgeSource      = signal('');
  edgeTarget      = signal('');
  edgeType        = signal('sequential');
  edgeLabel       = signal('');

  // ── IA Chat State ────────────────────────────────────────────
  showIaPanel     = signal(false);
  iaQuestion      = signal('');
  isListeningIa   = signal(false);
  isProcessingIa  = signal(false);
  chatMessages    = signal<{ role: 'user' | 'agent'; text: string }[]>([]);
  private recognition: any;

  // ── ngx-graph observables ────────────────────────────────────
  update$     = new Subject<boolean>();
  center$     = new Subject<boolean>();
  zoomToFit$  = new Subject<any>();

  readonly palette       = NODE_PALETTE;
  readonly layoutSettings = { orientation: 'LR', rankPadding: 80, nodePadding: 30 };

  // ─────────────────────────────────────────────────────────────
  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.policyId.set(id);
      this.loadPolicy(id);
    } else {
      this.addDefaultSwimlane();
    }
    this.initSpeechRecognition();
  }

  ngOnDestroy(): void {
    this.wsSvc.disconnect();
  }

  loadPolicy(id: string): void {
    this.loading.set(true);
    this.policySvc.getById(id).subscribe({
      next: (p) => {
        this.policyName.set(p.name);
        this.policyDesc.set(p.description);
        this.collaborators.set(p.collaborators || []);
        this.parseDiagram(p.diagram ?? {});
        this.loading.set(false);
        setTimeout(() => this.zoomToFit$.next({ autoCenter: true }), 400);

        // Connect to WS once the policy is loaded
        this.wsSvc.connect(() => {
          this.wsSvc.subscribe(`/topic/policy/${id}`, (diagramMsg) => {
            if (diagramMsg) {
              this.parseDiagram(diagramMsg);
            }
          });
        });
      },
      error: () => this.loading.set(false)
    });
  }

  parseDiagram(diagram: Record<string, unknown>): void {
    const rawSwimlanes = (diagram['swimlanes'] as DiagramSwimlane[]) ?? [];
    const rawNodes     = (diagram['nodes']     as any[]) ?? [];
    const rawEdges     = (diagram['edges']     as any[]) ?? [];

    this.swimlanes.set(rawSwimlanes);

    this.graphNodes.set(rawNodes.map(n => ({
      id: n.id, label: n.data?.label ?? '', data: { ...(n.data ?? {}), type: n.data?.type ?? 'task' }
    })));

    this.graphLinks.set(rawEdges.map(e => ({
      id: e.id, source: e.source, target: e.target,
      label: e.label ?? '', data: { type: e.type ?? 'sequential' }
    })));

    this.clusters.set(rawSwimlanes.map(sl => ({
      id: sl.id, label: sl.label, data: { color: sl.color },
      childNodeIds: rawNodes.filter(n => n.data?.departmentId === sl.id).map((n:any) => n.id)
    })));

    this.update$.next(true);
  }

  // ── WebSockets Broadcast ──────────────────────────────────────
  broadcastUpdate(): void {
    const id = this.policyId();
    if (id) {
      const diagram = {
        swimlanes: this.swimlanes(),
        nodes: this.graphNodes().map(n => ({ id: n.id, data: n.data })),
        edges: this.graphLinks().map(e => ({
          id: e.id, source: e.source, target: e.target,
          label: e.label, type: e.data?.['type'] ?? 'sequential'
        }))
      };
      this.wsSvc.publish(`/app/policy/${id}/update`, diagram);
    }
  }

  // ── Swimlanes ─────────────────────────────────────────────────
  private addDefaultSwimlane(): void {
    this.doAddSwimlane('Departamento A');
  }

  openAddSwimlane(): void {
    this.newSwimlaneName = '';
    this.showAddSwimlane.set(true);
  }

  confirmAddSwimlane(): void {
    if (!this.newSwimlaneName.trim()) return;
    this.doAddSwimlane(this.newSwimlaneName.trim());
    this.showAddSwimlane.set(false);
    this.broadcastUpdate();
  }

  private doAddSwimlane(name: string): void {
    const id    = `sl-${Date.now()}`;
    const color = COLORS[this.swimlanes().length % COLORS.length];
    this.swimlanes.update(l => [...l, { id, label: name, color }]);
    this.clusters.update(l => [...l, { id, label: name, childNodeIds: [], data: { color } }]);
  }

  deleteSwimlane(id: string): void {
    this.swimlanes.update(l => l.filter(s => s.id !== id));
    this.clusters.update(l => l.filter(c => c.id !== id));
    this.broadcastUpdate();
  }

  // ── Collaborators ─────────────────────────────────────────────
  openAddCollaborator(): void {
    this.newCollaboratorEmail = '';
    this.emailError.set(null);
    this.showAddCollaborator.set(true);
  }

  confirmAddCollaborator(): void {
    const email = this.newCollaboratorEmail.trim();
    if (!email) return;

    this.resolvingEmail.set(true);
    this.emailError.set(null);

    this.userSvc.getByEmail(email).subscribe({
      next: (user) => {
        this.resolvingEmail.set(false);
        if (this.collaborators().includes(user.id)) {
          this.emailError.set('Este usuario ya es colaborador.');
          return;
        }

        const policyId = this.policyId();
        if (policyId) {
          this.policySvc.addCollaborator(policyId, user.id).subscribe({
            next: () => {
              this.collaborators.update(c => [...c, user.id]);
              this.showAddCollaborator.set(false);
            },
            error: (err) => this.emailError.set('Error al guardar el colaborador.')
          });
        } else {
          this.collaborators.update(c => [...c, user.id]);
          this.showAddCollaborator.set(false);
        }
      },
      error: () => {
        this.resolvingEmail.set(false);
        this.emailError.set(`No se encontró un usuario con el email "${email}"`);
      }
    });
  }

  removeCollaborator(userId: string): void {
    const policyId = this.policyId();
    if (policyId) {
      this.policySvc.removeCollaborator(policyId, userId).subscribe({
        next: () => this.collaborators.update(c => c.filter(id => id !== userId))
      });
    } else {
      this.collaborators.update(c => c.filter(id => id !== userId));
    }
  }

  // ── Nodes ─────────────────────────────────────────────────────
  openAddNode(type: NodeType): void {
    this.addingNodeType.set(type);
    this.newNodeLabel    = type === 'start' ? 'Inicio' : type === 'end' ? 'Fin' : '';
    this.newNodeSwimlane = this.swimlanes()[0]?.id ?? '';
    this.newNodeUser     = '';
    this.showAddNode.set(true);
  }

  confirmAddNode(): void {
    if (!this.newNodeLabel.trim()) return;
    const id      = `n-${Date.now()}`;
    const type    = this.addingNodeType();
    const newNode: Node = {
      id, label: this.newNodeLabel,
      data: { label: this.newNodeLabel, type, userId: this.newNodeUser, departmentId: this.newNodeSwimlane }
    };
    this.graphNodes.update(l => [...l, newNode]);
    this.clusters.update(l => l.map(cl =>
      cl.id === this.newNodeSwimlane
        ? { ...cl, childNodeIds: [...(cl.childNodeIds ?? []), id] }
        : cl
    ));
    this.showAddNode.set(false);
    setTimeout(() => {
      this.update$.next(true);
      this.broadcastUpdate();
    }, 50);
  }

  onNodeSelect(node: Node): void {
    this.selectedNode.set({ ...node });
    this.selectedNodeEmail.set(node.data?.userEmail ?? '');
    this.emailError.set(null);
  }

  resolveEmailAndUpdate(): void {
    const n = this.selectedNode();
    if (!n) return;

    const email = this.selectedNodeEmail().trim();

    if (!email) {
      this.selectedNode.set({ ...n, data: { ...n.data, userId: '', userEmail: '' } });
      this.updateNode();
      return;
    }

    this.resolvingEmail.set(true);
    this.emailError.set(null);

    this.userSvc.getByEmail(email).subscribe({
      next: (user) => {
        this.resolvingEmail.set(false);
        this.selectedNode.set({
          ...n,
          data: { ...n.data, userId: user.id, userEmail: email }
        });
        this.updateNode();
      },
      error: () => {
        this.resolvingEmail.set(false);
        this.emailError.set(`No se encontró un usuario con el email "${email}"`);
      }
    });
  }

  updateNode(): void {
    const n = this.selectedNode();
    if (!n) return;
    this.graphNodes.update(l => l.map(x => x.id === n.id ? { ...x, label: n.data.label, data: { ...n.data } } : x));
    // reassign cluster
    this.clusters.update(l => l.map(cl => ({
      ...cl,
      childNodeIds: (cl.childNodeIds ?? []).filter(id => id !== n.id)
    })));
    this.clusters.update(l => l.map(cl =>
      cl.id === n.data.departmentId
        ? { ...cl, childNodeIds: [...(cl.childNodeIds ?? []), n.id] }
        : cl
    ));
    this.update$.next(true);
    this.broadcastUpdate();
  }

  deleteNode(): void {
    const n = this.selectedNode();
    if (!n) return;
    this.graphNodes.update(l => l.filter(x => x.id !== n.id));
    this.graphLinks.update(l => l.filter(e => e.source !== n.id && e.target !== n.id));
    this.clusters.update(l => l.map(cl => ({
      ...cl, childNodeIds: (cl.childNodeIds ?? []).filter(id => id !== n.id)
    })));
    this.selectedNode.set(null);
    this.update$.next(true);
    this.broadcastUpdate();
  }

  // ── Edges ─────────────────────────────────────────────────────
  openAddEdge(): void {
    this.edgeSource.set(this.graphNodes()[0]?.id ?? '');
    this.edgeTarget.set(this.graphNodes()[1]?.id ?? '');
    this.edgeType.set('sequential');
    this.edgeLabel.set('');
    this.showAddEdge.set(true);
  }

  confirmAddEdge(): void {
    const src = this.edgeSource();
    const tgt = this.edgeTarget();
    if (!src || !tgt || src === tgt) return;
    const id = `e-${Date.now()}`;
    this.graphLinks.update(l => [...l, {
      id, source: src, target: tgt,
      label: this.edgeLabel(), data: { type: this.edgeType() }
    }]);
    this.showAddEdge.set(false);
    setTimeout(() => {
      this.update$.next(true);
      this.broadcastUpdate();
    }, 50);
  }

  // ── Save ──────────────────────────────────────────────────────
  save(): void {
    this.saving.set(true);
    const diagram: Record<string, unknown> = {
      swimlanes: this.swimlanes(),
      nodes: this.graphNodes().map(n => ({ id: n.id, data: n.data })),
      edges: this.graphLinks().map(e => ({
        id: e.id, source: e.source, target: e.target,
        label: e.label, type: e.data?.['type'] ?? 'sequential'
      }))
    };
    const req: PolicyRequest = {
      name: this.policyName(), description: this.policyDesc(),
      diagram, status: 'DRAFT',
      collaborators: this.collaborators()
    };
    const id = this.policyId();
    const obs = id ? this.policySvc.update(id, req) : this.policySvc.create(req);
    obs.subscribe({
      next: (p) => {
        if (!id) {
          this.policyId.set(p.id);
          this.router.navigate(['/admin/designer', p.id], { replaceUrl: true });
        }
        this.saving.set(false);
      },
      error: () => this.saving.set(false)
    });
  }

  // ── Helpers ───────────────────────────────────────────────────
  nodeColor(type: string): string {
    return this.palette.find(p => p.type === type)?.color ?? '#5b6ef0';
  }
  nodeIcon(type: string): string {
    return this.palette.find(p => p.type === type)?.icon ?? '□';
  }
  swimlaneColor(id: string): string {
    return this.swimlanes().find(s => s.id === id)?.color ?? '#5b6ef0';
  }

  setSelectedProp(prop: string, value: string): void {
    const n = this.selectedNode();
    if (!n) return;
    this.selectedNode.set({ ...n, data: { ...n.data, [prop]: value } });
  }

  getPaletteLabel(type: NodeType): string {
    return this.palette.find(p => p.type === type)?.label ?? type;
  }

  get canSave(): boolean { return !!this.policyName().trim() && !this.saving(); }
  trackById(_: number, x: { id: string }): string { return x.id; }

  // ── IA Chat ───────────────────────────────────────────────────
  toggleIaPanel(): void {
    this.showIaPanel.set(!this.showIaPanel());
  }

  private initSpeechRecognition(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'es-ES';
    this.recognition.interimResults = false;
    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.iaQuestion.update(v => v ? v + ' ' + transcript : transcript);
    };
    this.recognition.onerror = () => this.isListeningIa.set(false);
    this.recognition.onend   = () => this.isListeningIa.set(false);
  }

  toggleIaVoice(): void {
    if (!this.recognition) return;
    if (this.isListeningIa()) {
      this.recognition.stop();
      this.isListeningIa.set(false);
    } else {
      this.recognition.start();
      this.isListeningIa.set(true);
    }
  }

  sendIaMessage(): void {
    const q = this.iaQuestion().trim();
    if (!q || this.isProcessingIa()) return;

    // Push user message
    this.chatMessages.update(msgs => [...msgs, { role: 'user', text: q }]);
    this.iaQuestion.set('');
    this.isProcessingIa.set(true);

    this.iaSvc.designerAgent(q).subscribe({
      next: (res) => {
        this.chatMessages.update(msgs => [
          ...msgs,
          { role: 'agent', text: res?.response ?? 'Sin respuesta.' }
        ]);
        this.isProcessingIa.set(false);
        // Scroll chat to bottom after render
        setTimeout(() => this.scrollChatToBottom(), 50);
      },
      error: (err) => {
        const msg = typeof err.error === 'string' ? err.error : 'Error al conectar con el agente.';
        this.chatMessages.update(msgs => [...msgs, { role: 'agent', text: `⚠️ ${msg}` }]);
        this.isProcessingIa.set(false);
        setTimeout(() => this.scrollChatToBottom(), 50);
      }
    });
  }
  sendDesignFlow(): void {
    const q = this.iaQuestion().trim();
    if (!q || this.isProcessingIa()) return;

    this.chatMessages.update(msgs => [...msgs, { role: 'user', text: `✨ ${q}` }]);
    this.iaQuestion.set('');
    this.isProcessingIa.set(true);

    const diagramObj = {
      swimlanes: this.swimlanes(),
      nodes: this.graphNodes().map(n => ({ id: n.id, data: n.data })),
      edges: this.graphLinks().map(e => ({
        id: e.id, source: e.source, target: e.target,
        label: e.label, type: e.data?.['type'] ?? 'sequential'
      }))
    };

    this.iaSvc.designFlow({ diagram: diagramObj, instruction: q }).subscribe({
      next: (res) => {
        if (res && res.diagram) {
          try {
            const newDiagram = typeof res.diagram === 'string' ? JSON.parse(res.diagram) : res.diagram;
            this.parseDiagram(newDiagram);
            setTimeout(() => { this.update$.next(true); this.broadcastUpdate(); }, 100);
            this.chatMessages.update(msgs => [...msgs, { role: 'agent', text: '✅ Diagrama actualizado con éxito.' }]);
          } catch (e) {
            this.chatMessages.update(msgs => [...msgs, { role: 'agent', text: '⚠️ La IA respondió pero no pude interpretar el diagrama.' }]);
          }
        } else {
          this.chatMessages.update(msgs => [...msgs, { role: 'agent', text: '⚠️ Sin respuesta válida del servidor.' }]);
        }
        this.isProcessingIa.set(false);
        setTimeout(() => this.scrollChatToBottom(), 50);
      },
      error: (err) => {
        const msg = typeof err.error === 'string' ? err.error : 'Error al aplicar el cambio.';
        this.chatMessages.update(msgs => [...msgs, { role: 'agent', text: `⚠️ ${msg}` }]);
        this.isProcessingIa.set(false);
        setTimeout(() => this.scrollChatToBottom(), 50);
      }
    });
  }


  onIaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendIaMessage();
    }
  }

  private scrollChatToBottom(): void {
    const el = document.querySelector('.ia-chat__messages');
    if (el) el.scrollTop = el.scrollHeight;
  }
}
