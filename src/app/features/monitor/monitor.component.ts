import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { NgIf, NgFor, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../core/services/task.service';
import { ProcedureService } from '../../core/services/procedure.service';
import { IaService } from '../../core/services/ia.service';
import { Task, TaskStatus, Procedure } from '../../core/models';

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

  activeTab = signal<TabType>('pending');
  tasks = signal<TaskViewModel[]>([]);
  loading = signal<boolean>(true);

  // Modal State
  selectedTask = signal<TaskViewModel | null>(null);
  observation = signal<string>('');
  completing = signal<boolean>(false);

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
  }

  closeModal(): void {
    if (this.isRecording()) {
      this.stopRecording();
    }
    this.selectedTask.set(null);
    this.observation.set('');
    this.draftDescription.set('');
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

    this.iaSvc.generateReport({ taskLabel, description: draft }).subscribe({
      next: (res) => {
        this.observation.set(res.report);
        this.isGeneratingIa.set(false);
      },
      error: () => {
        alert('Hubo un error al generar el reporte con IA.');
        this.isGeneratingIa.set(false);
      }
    });
  }

  completeTask(): void {
    const task = this.selectedTask();
    if (!task || !this.observation().trim()) return;

    this.completing.set(true);
    this.taskSvc.completeTask(task.id, {
      report: { observation: this.observation().trim() }
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
}
