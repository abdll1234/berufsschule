import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface SensorReading {
  zeit: string;
  co2: number | null;
  licht: number | null;
  wasser: number | null;
  servo: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class SensorService {
  private readonly http = inject(HttpClient);
  private readonly ngZone = inject(NgZone);
  private readonly apiBaseUrl = this.normalizeBaseUrl(environment.apiBaseUrl);
  private readonly wsBaseUrl = this.normalizeBaseUrl(environment.wsBaseUrl);
  private readonly enableWebSocket = environment.enableWebSocket;

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private readonly currentSubject = new BehaviorSubject<SensorReading | null>(null);
  private readonly historySubject = new BehaviorSubject<SensorReading[]>([]);
  private readonly connectionSubject = new BehaviorSubject<ConnectionState>('connecting');

  private lastServoState: number | null = null;
  private audioContext: AudioContext | null = null;

  readonly current$ = this.currentSubject.asObservable();
  readonly history$ = this.historySubject.asObservable();
  readonly connection$ = this.connectionSubject.asObservable();

  constructor() {
    this.loadHistory();

    if (this.enableWebSocket) {
      this.connectWebSocket();
    } else {
      this.connectionSubject.next('online');
      this.startApiPolling();
    }
  }

  fetchHistory(limit: number | 'all' = 10): Observable<SensorReading[]> {
    const query = limit === 'all' ? 'limit=all' : `limit=${Math.max(1, Math.floor(limit))}`;
    const headers = this.shouldSendNgrokBypassHeader()
      ? new HttpHeaders({ 'ngrok-skip-browser-warning': 'true' })
      : undefined;

    return this.http
      .get<Partial<SensorReading>[]>(this.buildApiUrl(`/api/history?${query}`), headers ? { headers } : {})
      .pipe(map((rows) => rows.map((row) => this.normalizeReading(row))));
  }

  private connectWebSocket(): void {
    this.connectionSubject.next('connecting');

    const wsUrl = this.buildWsUrl();

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.ngZone.run(() => {
        this.connectionSubject.next('online');
      });
    };

    this.socket.onmessage = (event: MessageEvent<string>) => {
      this.ngZone.run(() => {
        try {
          const parsed = JSON.parse(event.data) as Partial<SensorReading>;
          const reading = this.normalizeReading(parsed);

          this.checkServoAlarm(reading.servo);

          this.currentSubject.next(reading);
          this.historySubject.next([reading, ...this.historySubject.value].slice(0, 10));
        } catch (error) {
          console.error('Invalid websocket payload:', error);
        }
      });
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };

    this.socket.onclose = () => {
      this.ngZone.run(() => {
        this.connectionSubject.next('offline');
        this.scheduleReconnect();
      });
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 2000);
  }

  private loadHistory(): void {
    this.fetchHistory(10).subscribe({
      next: (rows) => {
        const history = rows.slice(0, 10);
        this.historySubject.next(history);

        if (history.length > 0) {
          this.checkServoAlarm(history[0].servo);
          this.currentSubject.next(history[0]);
        }
      },
      error: (error) => {
        console.error('Could not load history:', error);

        if (!this.enableWebSocket) {
          this.connectionSubject.next('offline');
        }
      },
    });
  }

  private normalizeReading(row: Partial<SensorReading>): SensorReading {
    return {
      zeit: typeof row.zeit === 'string' ? row.zeit : new Date().toISOString(),
      co2: this.toNumberOrNull(row.co2),
      licht: this.toNumberOrNull(row.licht),
      wasser: this.toNumberOrNull(row.wasser),
      servo: this.toNumberOrNull(row.servo),
    };
  }

  private toNumberOrNull(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
  }

  private buildApiUrl(path: string): string {
    if (!this.apiBaseUrl) {
      return path;
    }

    return `${this.apiBaseUrl}${path}`;
  }

  private buildWsUrl(): string {
    if (this.wsBaseUrl) {
      return `${this.wsBaseUrl}/ws`;
    }

    if (this.apiBaseUrl) {
      const wsFromApi = this.apiBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
      return `${wsFromApi}/ws`;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${window.location.host}/ws`;
  }

  private shouldSendNgrokBypassHeader(): boolean {
    if (!this.apiBaseUrl) {
      return false;
    }

    try {
      const hostname = new URL(this.apiBaseUrl).hostname;
      return hostname.includes('ngrok-free.app') || hostname.includes('ngrok-free.dev');
    } catch {
      return this.apiBaseUrl.includes('ngrok-free.');
    }
  }

  private startApiPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.fetchHistory(10).subscribe({
        next: (rows) => {
          const history = rows.slice(0, 10);
          this.historySubject.next(history);

          if (history.length > 0) {
            this.checkServoAlarm(history[0].servo);
            this.currentSubject.next(history[0]);
          }

          this.connectionSubject.next('online');
        },
        error: (error) => {
          console.error('Polling failed:', error);
          this.connectionSubject.next('offline');
        },
      });
    }, 5000);
  }

  private checkServoAlarm(currentServo: number | null): void {
    if (currentServo === null) {
      return;
    }

    // Alarm wenn Servo von geschlossen (<= 0) auf offen (> 0) wechselt
    const wasClosed = this.lastServoState === null || this.lastServoState <= 0;
    const isNowOpen = currentServo > 0;

    if (wasClosed && isNowOpen) {
      this.playAlarm();
    }

    this.lastServoState = currentServo;
  }

  private playAlarm(): void {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, this.audioContext.currentTime); // A5 Note

      // Pulsierender Effekt für 3 Sekunden
      for (let i = 0; i < 3; i++) {
        oscillator.frequency.exponentialRampToValueAtTime(880, this.audioContext.currentTime + i);
        oscillator.frequency.exponentialRampToValueAtTime(440, this.audioContext.currentTime + i + 0.5);
        oscillator.frequency.exponentialRampToValueAtTime(880, this.audioContext.currentTime + i + 1);
      }

      gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 3);

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + 3);
    } catch (e) {
      console.error('Konnte Alarmton nicht abspielen:', e);
    }
  }
}
