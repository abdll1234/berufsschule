import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SensorService } from './sensor';

class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  constructor(_url: string) {}

  close(): void {}
}

describe('SensorService', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = window.WebSocket;
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });

    TestBed.inject(HttpTestingController).verify();
  });

  it('should be created', () => {
    const service = TestBed.inject(SensorService);
    const httpMock = TestBed.inject(HttpTestingController);

    httpMock.expectOne('/api/history?limit=10').flush([]);

    expect(service).toBeTruthy();
  });
});
