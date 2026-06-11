/**
 * OpenTelemetry Bootstrap
 *
 * Sampling strategy (production-safe):
 *   - HEAD-BASED: ParentBasedSampler wrapping TraceIdRatioBased(OTEL_SAMPLE_RATE, default 0.1)
 *     → ~10% of all traces are sampled; the same decision propagates to all downstream spans
 *       so a trace is either fully captured or fully dropped (no orphaned child spans).
 *
 *   - TAIL-BASED ERROR OVERRIDE: ErrorAlwaysSampleProcessor checks every span on end;
 *     if status.code === ERROR, it forces the span's trace to be exported regardless of
 *     the head-based decision. This guarantees error traces are never silently dropped.
 *
 * Activation: set OTEL_ENABLED=true
 * Tuning:     set OTEL_SAMPLE_RATE=0.05 (5%) or OTEL_SAMPLE_RATE=1.0 (100% for dev)
 * Endpoint:   set OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
 *
 * Uses require() instead of ESM import so ts-jest never type-checks the OTel package
 * internals — avoids TS2693 ("Resource only refers to a type") on newer @opentelemetry packages.
 */

import logger from '../utils/logger';

let _otelSdk: { shutdown: () => Promise<void> } | null = null;

if (process.env.OTEL_ENABLED === 'true') {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NodeSDK }                      = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations }  = require('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter }            = require('@opentelemetry/exporter-trace-otlp-http');
  const { Resource }                     = require('@opentelemetry/resources');
  const { SemanticResourceAttributes }   = require('@opentelemetry/semantic-conventions');
  const {
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
    BatchSpanProcessor,
    SpanStatusCode,
  } = require('@opentelemetry/sdk-trace-base');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const endpoint    = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
  const sampleRate  = parseFloat(process.env.OTEL_SAMPLE_RATE  || '0.1');

  // ── Samplers ──────────────────────────────────────────────────────────────
  // ParentBased: respect the sampling decision propagated in the W3C traceparent header.
  // If there is no parent, use TraceIdRatioBased to sample `sampleRate` fraction.
  const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) });

  // ── Error Always-Sample Span Processor ────────────────────────────────────
  // Wraps the standard BatchSpanProcessor. On onEnd(), if the span has ERROR status,
  // it forces the span through to the exporter even if the head sampler dropped it.
  const exporter = new OTLPTraceExporter({ url: endpoint });
  const batchProcessor = new BatchSpanProcessor(exporter);

  class ErrorAlwaysSampleProcessor {
    onStart(_span: any): void {}

    onEnd(span: any): void {
      if (span.status?.code === SpanStatusCode.ERROR) {
        // Force-export the error span even if head sampler dropped it
        batchProcessor.onEnd(span);
      }
    }

    async shutdown(): Promise<void> {
      await batchProcessor.shutdown();
    }

    async forceFlush(): Promise<void> {
      await batchProcessor.forceFlush();
    }
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]:    'railflow-api',
      [SemanticResourceAttributes.SERVICE_VERSION]: '2.1.0',
      environment: process.env.NODE_ENV || 'development',
    }),
    sampler,
    spanProcessors: [batchProcessor, new ErrorAlwaysSampleProcessor()],
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is extremely noisy — disable it
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  _otelSdk = sdk;

  logger.info({
    msg:         '[OTel] OpenTelemetry SDK started',
    endpoint,
    sampleRate:  `${(sampleRate * 100).toFixed(0)}% head-based + 100% error tail`,
    service:     'railflow-api',
    version:     '2.1.0',
  });
}

/**
 * Call this during graceful shutdown to flush any buffered spans before process exit.
 */
export async function shutdownOtel(): Promise<void> {
  if (_otelSdk) {
    try {
      await _otelSdk.shutdown();
      logger.info('[OTel] SDK shut down — all spans flushed.');
    } catch (err: any) {
      logger.warn({ msg: '[OTel] SDK shutdown error', error: err.message });
    }
  }
}
