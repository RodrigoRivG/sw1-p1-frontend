import { Injectable, inject } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private client: Client | null = null;
  private authService = inject(AuthService);

  connect(onConnectCallback?: () => void): void {
    if (this.client && this.client.active) {
      if (onConnectCallback) onConnectCallback();
      return;
    }

    const token = this.authService.getToken();
    const connectHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    this.client = new Client({
      webSocketFactory: () => new SockJS(`${environment.apiUrl.replace('/api', '')}/ws`),
      connectHeaders: connectHeaders,
      debug: (msg: string) => console.log('[STOMP]', msg),
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    this.client.onConnect = () => {
      console.log('[STOMP] Connected');
      if (onConnectCallback) onConnectCallback();
    };

    this.client.onStompError = (frame) => {
      console.error('[STOMP] Error: ', frame.headers['message']);
      console.error('[STOMP] Details: ', frame.body);
    };

    this.client.activate();
  }

  disconnect(): void {
    if (this.client && this.client.active) {
      this.client.deactivate();
    }
  }

  subscribe(topic: string, callback: (message: any) => void): StompSubscription | null {
    if (!this.client || !this.client.active) {
      console.warn('[STOMP] No se puede suscribir, no hay conexión activa.');
      return null;
    }

    return this.client.subscribe(topic, (message: IMessage) => {
      if (message.body) {
        try {
          const body = JSON.parse(message.body);
          console.log(`[STOMP] Mensaje recibido en ${topic}:`, body);
          callback(body);
        } catch (e) {
          console.log(`[STOMP] Mensaje de texto recibido en ${topic}:`, message.body);
          callback(message.body);
        }
      }
    });
  }

  publish(destination: string, body: any, headers?: Record<string, string>): void {
    if (this.client && this.client.active) {
      this.client.publish({
        destination,
        body: JSON.stringify(body),
        headers,
      });
    } else {
      console.warn('[STOMP] No se puede publicar, no hay conexión activa.');
    }
  }
}
