import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly currentSubject = new BehaviorSubject<SensorReading | null>(null);
  private readonly historySubject = new BehaviorSubject<SensorReading[]>([]);
  private readonly connectionSubject = new BehaviorSubject<ConnectionState>('connecting');

  readonly current$ = this.currentSubject.asObservable();
  readonly history$ = this.historySubject.asObservable();
  readonly connection$ = this.connectionSubject.asObservable();

  constructor() {
    this.loadHistory();
    this.connectWebSocket();
  }

  fetchHistory(limit: number | 'all' = 10): Observable<SensorReading[]> {
    const query = limit === 'all' ? 'limit=all' : `limit=${Math.max(1, Math.floor(limit))}`;

    return this.http.get<Partial<SensorReading>[]>(this.buildApiUrl(`/api/history?${query}`)).pipe(
      map((rows) => rows.map((row) => this.normalizeReading(row))),
    );
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
          this.currentSubject.next(history[0]);
        }
      },
      error: (error) => {
        console.error('Could not load history:', error);
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
}
