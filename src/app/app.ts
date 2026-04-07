import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConnectionState, SensorReading, SensorService } from './services/sensor';

interface AnalyticsRow {
  name: string;
  unit: string;
  latest: number | null;
  min: number | null;
  max: number | null;
  average: number | null;
  trend: number | null;
  className: string;
}

interface ChartRow {
  name: string;
  unit: string;
  latest: number | null;
  className: string;
  path: string;
  area: string;
  hasData: boolean;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly sensorService = inject(SensorService);

  readonly current = toSignal(this.sensorService.current$, {
    initialValue: null as SensorReading | null,
  });

  readonly history = toSignal(this.sensorService.history$, {
    initialValue: [] as SensorReading[],
  });

  readonly allTimeRows = signal<SensorReading[]>([]);
  readonly allTimeLoading = signal(false);
  readonly allTimeError = signal('');
  readonly allTimeGeneratedAt = signal<string | null>(null);

  readonly analyticsRows = computed(() => {
    const values = this.history();

    return [
      this.buildAnalyticsRow('CO2', 'ppm', values, (row) => row.co2, (value) => this.classifyCo2(value)),
      this.buildAnalyticsRow(
        'Licht',
        'lux',
        values,
        (row) => row.licht,
        (value) => this.classifyLight(value),
      ),
      this.buildAnalyticsRow(
        'Wasser',
        '%',
        values,
        (row) => row.wasser,
        (value) => this.classifyWater(value),
      ),
      this.buildAnalyticsRow(
        'Servo',
        'deg',
        values,
        (row) => row.servo,
        (value) => this.classifyServo(value),
      ),
    ];
  });

  readonly allTimeChartRows = computed(() => {
    const values = [...this.allTimeRows()].reverse();

    return [
      this.buildChartRow('CO2', 'ppm', values, (row) => row.co2, (value) => this.classifyCo2(value)),
      this.buildChartRow(
        'Licht',
        'lux',
        values,
        (row) => row.licht,
        (value) => this.classifyLight(value),
      ),
      this.buildChartRow(
        'Wasser',
        '%',
        values,
        (row) => row.wasser,
        (value) => this.classifyWater(value),
      ),
      this.buildChartRow(
        'Servo',
        'deg',
        values,
        (row) => row.servo,
        (value) => this.classifyServo(value),
      ),
    ];
  });

  readonly chartRows = computed(() => {
    const values = [...this.history()].reverse();

    return [
      this.buildChartRow('CO2', 'ppm', values, (row) => row.co2, (value) => this.classifyCo2(value)),
      this.buildChartRow(
        'Licht',
        'lux',
        values,
        (row) => row.licht,
        (value) => this.classifyLight(value),
      ),
      this.buildChartRow(
        'Wasser',
        '%',
        values,
        (row) => row.wasser,
        (value) => this.classifyWater(value),
      ),
      this.buildChartRow(
        'Servo',
        'deg',
        values,
        (row) => row.servo,
        (value) => this.classifyServo(value),
      ),
    ];
  });

  readonly connection = toSignal(this.sensorService.connection$, {
    initialValue: 'connecting' as ConnectionState,
  });

  readonly co2Class = computed(() => this.classifyCo2(this.current()?.co2 ?? null));
  readonly waterClass = computed(() => this.classifyWater(this.current()?.wasser ?? null));
  readonly lightClass = computed(() => this.classifyLight(this.current()?.licht ?? null));

  readonly servoMessage = computed(() => {
    const servo = this.current()?.servo;

    if (servo === null || servo === undefined) {
      return 'Warte auf Servo-Wert';
    }

    if (servo >= 180) {
      return 'Fenster offen - es wird gelueftet';
    }

    if (servo <= 0) {
      return 'Fenster geschlossen';
    }

    return `Fenster auf ${Math.round(servo)} Grad`;
  });

  readonly servoClass = computed(() => {
    const servo = this.current()?.servo;

    if (servo === null || servo === undefined) {
      return 'servo-idle';
    }

    if (servo >= 180) {
      return 'servo-open';
    }

    if (servo <= 0) {
      return 'servo-closed';
    }

    return 'servo-mid';
  });

  readonly connectionLabel = computed(() => {
    const status = this.connection();

    if (status === 'online') {
      return 'Verbunden';
    }

    if (status === 'offline') {
      return 'Getrennt';
    }

    return 'Verbinde...';
  });

  formatTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
  }

  generateAllTimeChart(): void {
    if (this.allTimeLoading()) {
      return;
    }

    this.allTimeLoading.set(true);
    this.allTimeError.set('');

    this.sensorService.fetchHistory('all').subscribe({
      next: (rows) => {
        this.allTimeRows.set(rows);
        this.allTimeGeneratedAt.set(new Date().toISOString());
        this.allTimeLoading.set(false);
      },
      error: (error) => {
        console.error('Could not load all-time history:', error);
        this.allTimeError.set('All-Time Daten konnten nicht geladen werden.');
        this.allTimeLoading.set(false);
      },
    });
  }

  formatValue(value: number | null, unit = ''): string {
    if (value === null) {
      return '--';
    }

    const formatted = new Intl.NumberFormat('de-DE', {
      maximumFractionDigits: 1,
    }).format(value);

    return unit ? `${formatted} ${unit}` : formatted;
  }

  formatTrend(value: number | null): string {
    if (value === null) {
      return '--';
    }

    const sign = value > 0 ? '+' : '';
    return `${sign}${this.formatValue(value)}`;
  }

  trendClass(value: number | null): string {
    if (value === null || value === 0) {
      return 'trend-neutral';
    }

    return value > 0 ? 'trend-up' : 'trend-down';
  }

  classifyCo2(value: number | null): string {
    if (value === null) {
      return 'metric-neutral';
    }

    if (value < 800) {
      return 'metric-good';
    }

    if (value < 1200) {
      return 'metric-warn';
    }

    return 'metric-bad';
  }

  classifyWater(value: number | null): string {
    if (value === null) {
      return 'metric-neutral';
    }

    if (value >= 45) {
      return 'metric-good';
    }

    if (value >= 25) {
      return 'metric-warn';
    }

    return 'metric-bad';
  }

  classifyLight(value: number | null): string {
    if (value === null) {
      return 'metric-neutral';
    }

    if (value >= 500) {
      return 'metric-good';
    }

    if (value >= 200) {
      return 'metric-warn';
    }

    return 'metric-bad';
  }

  private classifyServo(value: number | null): string {
    if (value === null) {
      return 'metric-neutral';
    }

    if (value >= 180) {
      return 'metric-good';
    }

    if (value > 0) {
      return 'metric-warn';
    }

    return 'metric-neutral';
  }

  private buildAnalyticsRow(
    name: string,
    unit: string,
    values: SensorReading[],
    selector: (reading: SensorReading) => number | null,
    classifier: (value: number | null) => string,
  ): AnalyticsRow {
    const selectedValues = values.map(selector).filter((value): value is number => value !== null);

    const latest = selectedValues.length > 0 ? selectedValues[0] : null;
    const previous = selectedValues.length > 1 ? selectedValues[1] : null;
    const min = selectedValues.length > 0 ? Math.min(...selectedValues) : null;
    const max = selectedValues.length > 0 ? Math.max(...selectedValues) : null;
    const average =
      selectedValues.length > 0
        ? selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length
        : null;
    const trend = latest !== null && previous !== null ? latest - previous : null;

    return {
      name,
      unit,
      latest,
      min,
      max,
      average,
      trend,
      className: classifier(latest),
    };
  }

  private buildChartRow(
    name: string,
    unit: string,
    values: SensorReading[],
    selector: (reading: SensorReading) => number | null,
    classifier: (value: number | null) => string,
  ): ChartRow {
    const selectedValues = values.map(selector).filter((value): value is number => value !== null);
    const latest = selectedValues.length > 0 ? selectedValues[selectedValues.length - 1] : null;
    const sparkline = this.buildSparkline(selectedValues);

    return {
      name,
      unit,
      latest,
      className: classifier(latest),
      path: sparkline.path,
      area: sparkline.area,
      hasData: sparkline.hasData,
    };
  }

  private buildSparkline(values: number[]): { path: string; area: string; hasData: boolean } {
    if (values.length === 0) {
      return {
        path: '',
        area: '',
        hasData: false,
      };
    }

    const width = 280;
    const height = 86;
    const padding = 8;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = values.length === 1 ? 0 : (width - padding * 2) / (values.length - 1);

    const points = values.map((value, index) => {
      const x = padding + step * index;
      const normalized = (value - min) / range;
      const y = height - padding - normalized * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const endX = padding + step * (values.length - 1);

    return {
      path: points.join(' '),
      area: `${padding},${height - padding} ${points.join(' ')} ${endX.toFixed(2)},${height - padding}`,
      hasData: true,
    };
  }
}
