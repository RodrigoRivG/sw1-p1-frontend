import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { NgIf, NgFor, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../core/services/task.service';
import { ProcedureService } from '../../core/services/procedure.service';
import { IaService } from '../../core/services/ia.service';
import { PolicyService } from '../../core/services/policy.service';
import { AuthService } from '../../core/services/auth.service';
import { DocumentService } from '../../core/services/document.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { Task, TaskStatus, Procedure, DbDocument, DocumentVersion, PermissionLevel } from '../../core/models';
import Quill from 'quill';

type TabType = 'pending' | 'in_progress' | 'completed';

interface TaskViewModel extends Task {
  procedureDetails?: Procedure;
}

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, DatePipe],
  templateUrl: './monitor.component.html',
  styleUrl: './monitor.component.scss'
})
export class MonitorComponent implements OnInit {
  private taskSvc = inject(TaskService);
  private procSvc = inject(ProcedureService);
  private iaSvc = inject(IaService);
  private policySvc = inject(PolicyService);

  activeTab = signal<TabType>('pending');
  tasks = signal<TaskViewModel[]>([]);
  loading = signal<boolean>(true);

  // Form State
  formElements = signal<any[]>([]);
  formValues: Record<string, string> = {};
  activeMicFieldId: string | null = null;

  // Modal State
  selectedTask = signal<TaskViewModel | null>(null);
  observation = signal<string>('');
  completing = signal<boolean>(false);

  // DMS Signals
  taskDocuments = signal<Array<{ document: DbDocument, permissionLevel: PermissionLevel }>>([]);
  selectedDocument = signal<DbDocument | null>(null);
  selectedDocPermission = signal<PermissionLevel>('NONE');
  loadingDocs = signal<boolean>(false);
  versionHistory = signal<DocumentVersion[]>([]);
  loadingHistory = signal<boolean>(false);
  activeEditors = signal<any[]>([]);
  showSaveVersionModal = signal(false);
  newVersionDescription = '';
  selectedUploadFile: File | null = null;
  uploadVersionDescription = '';
  uploadingVersion = signal(false);

  private docSvc = inject(DocumentService);
  private wsSvc = inject(WebsocketService);
  private authService = inject(AuthService);
  private quill: any = null;
  private stompSubscription: any = null;

  // IA State
  draftDescription = signal<string>('');
  isRecording = signal<boolean>(false);
  isGeneratingIa = signal<boolean>(false);
  private recognition: any;

  // Computed arrays for tabs
  pendingTasks = computed(() => this.tasks().filter(t => t.status === 'pending'));
  inProgressTasks = computed(() => this.tasks().filter(t => t.status === 'in_progress'));
  completedTasks = computed(() => this.tasks().filter(t => t.status === 'completed'));

  ngOnInit(): void {
    this.loadTasks();
  }

  loadTasks(): void {
    this.loading.set(true);
    this.taskSvc.getMyTasks().subscribe({
      next: (data) => {
        this.tasks.set(data);
        this.loading.set(false);
        this.loadProcedureDetails(data);
      },
      error: () => this.loading.set(false)
    });
  }

  private loadProcedureDetails(tasks: Task[]): void {
    // Unique procedure IDs
    const procIds = Array.from(new Set(tasks.map(t => t.procedureId)));

    procIds.forEach(procId => {
      this.procSvc.getById(procId).subscribe({
        next: (proc) => {
          this.tasks.update(list => list.map(t =>
            t.procedureId === procId ? { ...t, procedureDetails: proc } : t
          ));
        }
      });
    });
  }

  setTab(tab: TabType): void {
    this.activeTab.set(tab);
  }

  openTaskModal(task: TaskViewModel): void {
    // Only pending or in_progress tasks can be completed
    if (task.status === 'completed') return;

    this.selectedTask.set(task);
    this.observation.set('');
    this.draftDescription.set('');
    this.isRecording.set(false);
    this.isGeneratingIa.set(false);

    // Load form fields from policy if exists
    this.formElements.set([]);
    this.formValues = {};

    const policyId = task.procedureDetails?.policyId;
    if (policyId) {
      this.policySvc.getById(policyId).subscribe({
        next: (policy) => {
          const nodes = (policy.diagram?.['nodes'] as any[]) || [];
          const matchedNode = nodes.find(n => n.id === task.nodeId);
          if (matchedNode?.data?.formFields?.length > 0) {
            this.formElements.set(matchedNode.data.formFields);
            matchedNode.data.formFields.forEach((fe: any) => {
              if (fe.type === 'input') {
                this.formValues[fe.id] = '';
              }
            });
          }
        },
        error: (err) => console.error('Error loading policy for task form:', err)
      });
    }

    // DMS: Cargar documentos y permisos
    this.taskDocuments.set([]);
    this.selectedDocument.set(null);
    this.selectedDocPermission.set('NONE');
    if (policyId) {
      this.loadingDocs.set(true);
      this.docSvc.getDocumentsByPolicy(policyId).subscribe({
        next: (docs) => {
          const docPromises = docs.map(doc => {
            return new Promise<any>((resolve) => {
              this.docSvc.getDocumentPermissions(doc.id).subscribe({
                next: (perms) => {
                  const perm = perms.find(p => p.nodeId === task.nodeId);
                  resolve({ document: doc, permissionLevel: perm ? perm.permissionLevel : 'NONE' });
                },
                error: () => {
                  resolve({ document: doc, permissionLevel: 'NONE' as PermissionLevel });
                }
              });
            });
          });

          Promise.all(docPromises).then(results => {
            const accessibleDocs = results.filter(r => r.permissionLevel !== 'NONE');
            this.taskDocuments.set(accessibleDocs);
            this.loadingDocs.set(false);
          });
        },
        error: (err) => {
          console.error('Error loading documents:', err);
          this.loadingDocs.set(false);
        }
      });
    }
  }

  closeModal(): void {
    if (this.isRecording()) {
      this.stopRecording();
    }
    this.cleanupWebSocket();
    this.selectedTask.set(null);
    this.observation.set('');
    this.draftDescription.set('');
    this.formElements.set([]);
    this.formValues = {};
    this.activeMicFieldId = null;
  }

  // --- IA & Speech Recognition Logic ---

  toggleRecording(): void {
    if (this.isRecording()) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  startRecording(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Tu navegador no soporta reconocimiento de voz. Intentá con Chrome.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'es-ES';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const currentDraft = this.draftDescription();
      // Solo sumamos el final a lo que ya había, y el interim lo mostramos como preview (opcional)
      // Para simplificar, actualizamos con el texto final + el progreso temporal.
      // Sería ideal mantener el estado anterior y sumarle lo nuevo.
      if (finalTranscript) {
        this.draftDescription.set(currentDraft + ' ' + finalTranscript.trim());
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      this.isRecording.set(false);
    };

    this.recognition.onend = () => {
      this.isRecording.set(false);
    };

    this.recognition.start();
    this.isRecording.set(true);
  }

  stopRecording(): void {
    if (this.recognition) {
      this.recognition.stop();
    }
    this.isRecording.set(false);
  }



  generateIaReport(): void {
    const task = this.selectedTask();
    const draft = this.draftDescription().trim();
    if (!task || !draft) return;

    this.isGeneratingIa.set(true);
    const taskLabel = task.nodeLabel || task.nodeId;

    const fields = this.formElements();
    let descriptionToSend = draft;

    if (fields.length > 0) {
      const inputs = fields.filter(fe => fe.type === 'input');
      const fieldsInstructions = inputs.map(i => `- ID: "${i.id}", Campo: "${i.text}"`).join('\n');
      
      descriptionToSend = `${draft}\n\n[INSTRUCCIÓN DE LA APLICACIÓN - IMPORTANTE: Analiza la descripción anterior y extrae los datos para llenar los siguientes campos del formulario:\n${fieldsInstructions}\n\nResponde ESTRICTAMENTE con un bloque JSON que contenga los pares clave-valor correspondientes, por ejemplo:\n\`\`\`json\n{\n${inputs.map(i => `  "${i.id}": "..."`).join(',\n')}\n}\n\`\`\`\nNo agregues explicaciones adicionales fuera de este bloque JSON.]`;
    }

    this.iaSvc.generateReport({ taskLabel, description: descriptionToSend }).subscribe({
      next: (res) => {
        if (fields.length > 0) {
          const jsonMatch = res.report.match(/```json\s*([\s\S]*?)\s*```/) || res.report.match(/({[\s\S]*?})/);
          let parsed: Record<string, string> = {};
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[1]);
            } catch (e) {
              console.error('Error parsing JSON from IA report:', e);
            }
          } else {
            try {
              parsed = JSON.parse(res.report.trim());
            } catch (e) {
              console.error('Error parsing direct JSON from IA report:', e);
            }
          }

          if (parsed && Object.keys(parsed).length > 0) {
            Object.keys(parsed).forEach(key => {
              if (this.formValues.hasOwnProperty(key)) {
                this.formValues[key] = parsed[key];
              }
            });
            this.formValues = { ...this.formValues };
          } else {
            alert('La IA generó una respuesta pero no se pudieron extraer los campos del formulario. Asegúrate de que el borrador contenga información relevante para los campos.');
          }
        } else {
          this.observation.set(res.report);
        }
        this.isGeneratingIa.set(false);
      },
      error: () => {
        alert('Hubo un error al generar el reporte con IA.');
        this.isGeneratingIa.set(false);
      }
    });
  }

  isFormValid(): boolean {
    const fields = this.formElements();
    if (fields.length === 0) {
      return this.observation().trim().length > 0;
    }
    return fields.filter(fe => fe.type === 'input')
                 .every(fe => (this.formValues[fe.id] || '').trim().length > 0);
  }

  completeTask(): void {
    const task = this.selectedTask();
    if (!task) return;

    let finalObservation = this.observation().trim();

    // Format form values if form fields exist
    const fields = this.formElements();
    if (fields.length > 0) {
      let formSummary = '📋 RESPUESTAS DEL FORMULARIO:\n';
      fields.forEach(fe => {
        if (fe.type === 'input') {
          const val = (this.formValues[fe.id] || '').trim() || '(Vacío)';
          formSummary += `- ${fe.text}: ${val}\n`;
        }
      });

      if (finalObservation) {
        finalObservation = `${formSummary}\n✍️ OBSERVACIONES ADICIONALES:\n${finalObservation}`;
      } else {
        finalObservation = formSummary;
      }
    }

    if (!finalObservation) return;

    this.completing.set(true);
    this.taskSvc.completeTask(task.id, {
      report: { observation: finalObservation }
    }).subscribe({
      next: (updatedTask) => {
        this.completing.set(false);
        this.closeModal();
        // Update the task list locally or reload
        this.loadTasks();
      },
      error: () => {
        this.completing.set(false);
        alert('Error al completar la tarea.');
      }
    });
  }

  // --- Gestor Documental (DMS) Métodos ---
  cleanupWebSocket(): void {
    if (this.stompSubscription) {
      this.stompSubscription.unsubscribe();
      this.stompSubscription = null;
    }
    this.activeEditors.set([]);
  }

  selectDocument(item: { document: DbDocument, permissionLevel: PermissionLevel }): void {
    this.cleanupWebSocket();
    this.selectedDocument.set(item.document);
    this.selectedDocPermission.set(item.permissionLevel);
    
    this.versionHistory.set([]);
    this.quill = null;

    const doc = item.document;

    // Cargar historial de versiones y contenido inicial
    this.loadVersionHistory(doc.id, (latestContent) => {
      if (item.permissionLevel === 'EDIT' || item.permissionLevel === 'VIEW') {
        this.initQuill(latestContent);
      }
    });

    // Conectar WebSocket si es edición
    if (item.permissionLevel === 'EDIT') {
      const user = this.authService.currentUser();
      if (user) {
        this.wsSvc.connect(() => {
          this.stompSubscription = this.wsSvc.subscribe(`/topic/documents/${doc.id}`, (msg: any) => {
            if (!msg) return;

            // Listado de usuarios activos
            if (Array.isArray(msg)) {
              this.activeEditors.set(msg);
            } else if (msg.activeUsers && Array.isArray(msg.activeUsers)) {
              this.activeEditors.set(msg.activeUsers);
            }

            // Actualización colaborativa del editor
            if (msg.content !== undefined && msg.senderId !== user.id) {
              if (this.quill && this.quill.root.innerHTML !== msg.content) {
                const selection = this.quill.getSelection();
                this.quill.root.innerHTML = msg.content || '';
                if (selection) {
                  this.quill.setSelection(selection.index, selection.length);
                }
              }
            }

            // Notificación de guardado
            if (msg.type === 'SAVE' || msg.saved || msg.type === 'saved') {
              this.loadVersionHistory(doc.id);
            }
          });

          // Unirse a la sala
          this.wsSvc.publish(`/app/documents/${doc.id}/join`, {
            userId: user.id,
            userName: `${user.firstName} ${user.lastName}`
          });
        });
      }
    }
  }

  initQuill(initialContent: string = ''): void {
    setTimeout(() => {
      const container = document.getElementById('editor-container');
      if (!container) return;

      this.quill = new Quill(container, {
        theme: 'snow',
        placeholder: 'Comienza a redactar aquí...',
        readOnly: this.selectedDocPermission() === 'VIEW'
      });

      this.quill.root.innerHTML = initialContent || '';

      // Enviar ediciones
      this.quill.on('text-change', (delta: any, oldDelta: any, source: string) => {
        if (source === 'user') {
          const doc = this.selectedDocument();
          if (doc) {
            const content = this.quill.root.innerHTML;
            this.wsSvc.publish(`/app/documents/${doc.id}/edit`, {
              content,
              senderId: this.authService.currentUser()?.id
            });
          }
        }
      });

      // Enviar posición del cursor
      this.quill.on('selection-change', (range: any) => {
        if (range) {
          const doc = this.selectedDocument();
          const user = this.authService.currentUser();
          if (doc && user) {
            this.wsSvc.publish(`/app/documents/${doc.id}/cursor`, {
              userId: user.id,
              userName: `${user.firstName} ${user.lastName}`,
              cursorIndex: range.index
            });
          }
        }
      });
    }, 100);
  }

  loadVersionHistory(docId: string, callback?: (content: string) => void): void {
    this.loadingHistory.set(true);
    this.docSvc.getVersionHistory(docId).subscribe({
      next: (versions) => {
        const sorted = (versions || []).sort((a, b) => b.versionNumber - a.versionNumber);
        this.versionHistory.set(sorted);
        this.loadingHistory.set(false);

        if (callback) {
          const latest = sorted[0];
          callback(latest?.content || '');
        }
      },
      error: (err) => {
        console.error('Error fetching version history:', err);
        this.loadingHistory.set(false);
        if (callback) callback('');
      }
    });
  }

  openSaveVersionModal(): void {
    this.newVersionDescription = '';
    this.showSaveVersionModal.set(true);
  }

  confirmSaveVersion(): void {
    const doc = this.selectedDocument();
    if (!doc || !this.quill) return;

    const content = this.quill.root.innerHTML;
    this.wsSvc.publish(`/app/documents/${doc.id}/save`, {
      content,
      changeDescription: this.newVersionDescription.trim() || 'Actualización colaborativa'
    });
    
    this.showSaveVersionModal.set(false);
    this.newVersionDescription = '';
  }

  onUploadFileSelected(event: any): void {
    const file = event.target.files?.[0];
    if (file) {
      this.selectedUploadFile = file;
    }
  }

  uploadNewVersion(): void {
    const doc = this.selectedDocument();
    if (!doc || !this.selectedUploadFile) return;

    this.uploadingVersion.set(true);
    this.docSvc.updateDocument(
      doc.id, 
      this.selectedUploadFile, 
      this.uploadVersionDescription.trim() || 'Nueva versión cargada por archivo'
    ).subscribe({
      next: () => {
        this.uploadingVersion.set(false);
        this.selectedUploadFile = null;
        this.uploadVersionDescription = '';
        this.loadVersionHistory(doc.id);
        alert('Nueva versión de archivo subida correctamente.');
      },
      error: (err) => {
        console.error('Error uploading new version:', err);
        this.uploadingVersion.set(false);
        alert('Error al subir la nueva versión.');
      }
    });
  }

  restoreVersion(versionNumber: number): void {
    const doc = this.selectedDocument();
    if (!doc || !confirm(`¿Estás seguro de restaurar el documento a la versión ${versionNumber}?`)) return;

    this.docSvc.restoreVersion(doc.id, versionNumber).subscribe({
      next: () => {
        alert(`Documento restaurado a la versión ${versionNumber}.`);
        this.loadVersionHistory(doc.id, (content) => {
          if (this.quill) {
            this.quill.root.innerHTML = content;
          }
        });
      },
      error: (err) => {
        console.error('Error restoring version:', err);
        alert('Error al restaurar la versión.');
      }
    });
  }
}
