import promClient from 'prom-client';
export const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });
export const metrics = {
  apiRequestLatency: new promClient.Histogram({
    name: 'api_request_latency_ms',
    help: 'API request latency in milliseconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [1, 5, 15, 50, 100, 500, 1000, 5000]
  }),

  agentLatency: new promClient.Histogram({
    name: 'agent_latency_ms',
    help: 'Agent execution latency in milliseconds',
    labelNames: ['agent', 'step'],
    buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000]
  }),

  toolCallTotal: new promClient.Counter({
    name: 'tool_call_total',
    help: 'Total number of tool calls',
    labelNames: ['tool', 'ok']
  }),

  agentFallbackTotal: new promClient.Counter({
    name: 'agent_fallback_total',
    help: 'Total number of agent fallbacks',
    labelNames: ['tool']
  }),

  rateLimitBlockTotal: new promClient.Counter({
    name: 'rate_limit_block_total',
    help: 'Total number of rate limit blocks'
  }),

  actionBlockedTotal: new promClient.Counter({
    name: 'action_blocked_total',
    help: 'Total number of blocked actions',
    labelNames: ['policy']
  })
};

register.registerMetric(metrics.apiRequestLatency);
register.registerMetric(metrics.agentLatency);
register.registerMetric(metrics.toolCallTotal);
register.registerMetric(metrics.agentFallbackTotal);
register.registerMetric(metrics.rateLimitBlockTotal);
register.registerMetric(metrics.actionBlockedTotal);